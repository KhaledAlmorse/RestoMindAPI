import {
  ConflictException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentRepository,
  RestaurantRepository,
  SubscriptionPlanRepository,
} from 'src/DB/Repositories';
import { SubscriptionPlanType } from 'src/DB/Models';
import { BILLING_INTERVALS, BillingInterval, capValue } from './billing-interval';
import { assertMonotonicLadder } from './plan-pricing';
import { CreatePlanDto, UpdatePlanDto } from './dto/subscription-plan.dto';

@Injectable()
export class SubscriptionPlansService {
  private readonly logger = new Logger(SubscriptionPlansService.name);

  constructor(
    private readonly subscriptionPlanRepository: SubscriptionPlanRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly paymentRepository: PaymentRepository,
  ) {}

  /** Every plan, archived ones included, in display order. */
  async list(includeArchived = true): Promise<SubscriptionPlanType[]> {
    const plans =
      (await this.subscriptionPlanRepository.findMany({
        filters: includeArchived ? {} : { archived: false },
      })) ?? [];

    return [...plans].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * What a merchant may actually be offered.
   *
   * A plan with no priced interval is hidden rather than sold at zero — that
   * is the state a half-configured plan sits in while an admin is still
   * filling it out.
   */
  async listSellable(): Promise<SubscriptionPlanType[]> {
    const plans = await this.list(false);
    return plans.filter((plan) =>
      BILLING_INTERVALS.some(
        (interval) =>
          plan.prices?.[interval] !== null &&
          plan.prices?.[interval] !== undefined,
      ),
    );
  }

  async getBySlug(slug: string): Promise<SubscriptionPlanType> {
    const plan = await this.subscriptionPlanRepository.findOne({
      filters: { slug },
    });
    if (!plan) throw new NotFoundException(`No plan with slug "${slug}"`);
    return plan;
  }

  /**
   * The plan a trial borrows its capacity from.
   *
   * Returns null rather than throwing: a database with no trial plan should
   * degrade to "no trial", not break onboarding entirely.
   */
  async getTrialPlan(): Promise<SubscriptionPlanType | null> {
    return await this.subscriptionPlanRepository.findOne({
      filters: { isTrialPlan: true },
    });
  }

  /** The cheapest sellable plan with strictly more capacity than `cap`. */
  async nextPlanAbove(cap: number): Promise<SubscriptionPlanType | null> {
    const bigger = (await this.listSellable())
      .filter((plan) => capValue(plan.productCap) > cap)
      .sort((a, b) => capValue(a.productCap) - capValue(b.productCap));

    return bigger[0] ?? null;
  }

  async create(dto: CreatePlanDto, adminId: string) {
    const prices = {
      monthly: dto.prices?.monthly ?? null,
      halfYearly: dto.prices?.halfYearly ?? null,
      yearly: dto.prices?.yearly ?? null,
    };
    assertMonotonicLadder(prices);

    const existing = await this.subscriptionPlanRepository.findOne({
      filters: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException(
        `A plan with slug "${dto.slug}" already exists.`,
      );
    }

    const created = await this.subscriptionPlanRepository.create({
      ...dto,
      productCap: dto.productCap ?? null,
      prices,
    } as any);

    if (dto.isTrialPlan) await this.clearTrialFlagExcept(dto.slug);

    this.logger.log(`Admin ${adminId} created plan ${dto.slug}`);
    return created;
  }

  async update(slug: string, dto: UpdatePlanDto, adminId: string) {
    if (dto.slug !== undefined && dto.slug !== slug) {
      throw new BadRequestException(
        'A plan slug cannot be changed — restaurants and payments reference it. Create a new plan instead.',
      );
    }

    const plan = await this.getBySlug(slug);

    // Validate the MERGED ladder, never the patch alone: setting only the
    // yearly price must still be checked against the existing monthly one,
    // or an admin could break the ladder one field at a time.
    //
    // Read the three fields explicitly rather than spreading `plan.prices` —
    // it is a Mongoose subdocument, and spreading copies internal state.
    // `undefined` means "not in this patch"; an explicit `null` means "stop
    // selling this interval". Using `??` would conflate the two and make
    // withdrawing an interval impossible.
    const merge = (key: BillingInterval) =>
      dto.prices?.[key] !== undefined
        ? (dto.prices[key] ?? null)
        : (plan.prices?.[key] ?? null);

    const prices = {
      monthly: merge('monthly'),
      halfYearly: merge('halfYearly'),
      yearly: merge('yearly'),
    };
    assertMonotonicLadder(prices);

    const { slug: _ignored, ...changes } = dto;
    await this.subscriptionPlanRepository.update({
      filters: { _id: plan._id },
      body: { ...changes, prices } as any,
    });

    if (dto.isTrialPlan) await this.clearTrialFlagExcept(slug);

    this.logger.log(
      `Admin ${adminId} updated plan ${slug}: ${JSON.stringify(changes)}`,
    );
    return await this.getBySlug(slug);
  }

  async setArchived(slug: string, archived: boolean, adminId: string) {
    const plan = await this.getBySlug(slug);

    if (archived && plan.isTrialPlan) {
      throw new ConflictException(
        'This is the trial plan — archiving it would leave new merchants with no trial capacity. Make another plan the trial plan first.',
      );
    }

    await this.subscriptionPlanRepository.update({
      filters: { _id: plan._id },
      body: { archived } as any,
    });

    this.logger.log(
      `Admin ${adminId} ${archived ? 'archived' : 'un-archived'} plan ${slug}`,
    );
    return await this.getBySlug(slug);
  }

  /**
   * Hard delete, refused whenever the plan is referenced.
   *
   * Deleting a plan a merchant holds would strand their entitlement, and
   * deleting one a payment references would make that payment unreadable.
   * Archiving is the operation an admin almost always actually wants.
   */
  async remove(slug: string, adminId: string) {
    const plan = await this.getBySlug(slug);

    const [holders, payments] = await Promise.all([
      this.restaurantRepository.countDocuments({ 'subscription.tier': slug }),
      this.paymentRepository.countDocuments({ tier: slug }),
    ]);

    if (holders > 0 || payments > 0) {
      throw new ConflictException(
        `Cannot delete "${plan.label}": ${holders} restaurant(s) are on this plan and ${payments} payment(s) reference it. Archive it instead — it will disappear for new buyers while existing holders keep it until their period ends.`,
      );
    }

    await this.subscriptionPlanRepository.delete({ filters: { _id: plan._id } });
    this.logger.log(`Admin ${adminId} deleted plan ${slug}`);
    return { slug, deleted: true };
  }

  /** Exactly one plan may be the trial plan. */
  private async clearTrialFlagExcept(slug: string): Promise<void> {
    await this.subscriptionPlanRepository.updateMany(
      { slug: { $ne: slug } },
      { isTrialPlan: false },
    );
  }
}
