import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
  PaymentMethodEnum,
  PaymentPurposeEnum,
  PaymentStatusEnum,
} from 'src/Common/Types';
import { addDays, addMonths, splitVat } from 'src/Common/Utils';
import {
  PaymentRepository,
  ProductRepository,
  RestaurantRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { PaymentType } from 'src/DB/Models/payment.model';
import { PaymentFulfiller } from 'src/payments/payment-fulfiller';
import { PaymentsService } from 'src/payments/payments.service';
import {
  getApiPublicUrl,
  getFrontendUrl,
} from 'src/payments/paymob.config';
import { SystemSettingsService } from 'src/system-settings/system-settings.service';
import {
  BILLING_INTERVALS,
  BillingInterval,
  INTERVAL_LABEL,
  INTERVAL_MONTHS,
  capValue,
} from './billing-interval';
import { perMonthCents, planPriceCents } from './plan-pricing';
import { SubscriptionPlansService } from './subscription-plans.service';
import {
  canPurchasePlan,
  effectiveProductCap,
  nextPeriodStart,
  resolveSubscriptionState,
} from './subscription-state';

/**
 * How long a started-but-unfinished checkout blocks another.
 *
 * Matches the equivalent guard on the order path. Long enough to cover 3-D
 * Secure and a wallet OTP, short enough that abandoning the Paymob page does
 * not lock the merchant out of paying for the rest of the day.
 */
const CHECKOUT_IN_FLIGHT_MS = 15 * 60 * 1000;

@Injectable()
export class SubscriptionsService implements PaymentFulfiller, OnModuleInit {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly restaurantRepository: RestaurantRepository,
    private readonly productRepository: ProductRepository,
    private readonly userRepository: UserRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly paymentsService: PaymentsService,
    private readonly systemSettingsService: SystemSettingsService,
    private readonly plansService: SubscriptionPlansService,
  ) {}

  /**
   * Whether this merchant is actually charged the early-bird price right now.
   *
   * Two conditions, and both matter: the merchant holds a seat, and the
   * platform switch is still on. Turning the switch off therefore reprices
   * every early bird at their next renewal without touching the month they
   * have already paid for — that payment is settled and immutable.
   */
  private async isEarlyBirdPriced(restaurant: {
    subscription?: { earlyBird?: boolean };
  }): Promise<boolean> {
    if (!restaurant.subscription?.earlyBird) return false;
    const settings = await this.systemSettingsService.get();
    return settings.earlyBirdEnabled;
  }

  async onModuleInit(): Promise<void> {
    this.paymentsService.registerFulfiller(
      PaymentPurposeEnum.SUBSCRIPTION,
      this,
    );
    await this.backfillMissingTrials();
  }

  /**
   * Gives the standard trial to restaurants that have no subscription at all.
   *
   * The trial is granted at partnership approval, so every restaurant onboarded
   * before this feature shipped — and every seeded one — has no subscription
   * object. Without this they resolve to `unpaid` the moment the code deploys:
   * dashboard locked, offers suspended, and the storefront refusing orders for
   * merchants who did nothing wrong. Backdating is not an option either, since
   * a trial that starts in the past is already over.
   *
   * Idempotent: the update itself creates the field it filters on, so a restart
   * matches nothing. A restaurant whose trial genuinely lapsed keeps its dates
   * and stays locked, which is the point.
   *
   * Skipped entirely while trials are switched off. A merchant onboarded under
   * that switch has no trialEndsAt and no currentPeriodEnd, so this query would
   * match them and hand them a trial at the next restart — silently undoing the
   * admin's decision. `setTrial` remains for granting one deliberately.
   */
  private async backfillMissingTrials(): Promise<void> {
    try {
      const settings = await this.systemSettingsService.get();
      if (!settings.freeTrialEnabled) {
        this.logger.log('Trial backfill skipped: free trials are switched off');
        return;
      }

      // Capacity comes from the plan flagged isTrialPlan. With no such plan
      // there is nothing to grant, and a trial with no cap would resolve to
      // zero products — worse than no trial at all.
      const trialPlan = await this.plansService.getTrialPlan();
      if (!trialPlan) {
        this.logger.warn(
          'Trial backfill skipped: no plan is flagged isTrialPlan, so there is no capacity to grant',
        );
        return;
      }

      const trialEndsAt = addDays(new Date(), settings.trialDurationDays);
      const result = await this.restaurantRepository.updateMany(
        {
          isDeleted: { $ne: true },
          'subscription.trialEndsAt': { $exists: false },
          'subscription.currentPeriodEnd': { $exists: false },
        },
        {
          $set: {
            'subscription.trialEndsAt': trialEndsAt,
            'subscription.trialProductCap': trialPlan.productCap ?? null,
          },
        },
      );

      if (result?.modifiedCount) {
        this.logger.log(
          `Granted a ${settings.trialDurationDays}-day trial to ${result.modifiedCount} restaurant(s) with no subscription, ending ${trialEndsAt.toISOString()}`,
        );
      }
    } catch (error: any) {
      // Never block boot on a migration. A restaurant left without a trial is
      // visible immediately as a locked dashboard, and an admin can set one.
      this.logger.error(`Trial backfill failed: ${error?.message}`);
    }
  }

  private async requireRestaurant(restaurantId: string | Types.ObjectId) {
    const restaurant = await this.restaurantRepository.findOne({
      filters: { _id: new Types.ObjectId(restaurantId.toString()) },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    return restaurant;
  }

  private countProducts(restaurantId: Types.ObjectId): Promise<number> {
    return this.productRepository.countDocuments({
      restaurantId,
      isDeleted: false,
    });
  }

  /** Everything the billing screen needs, in one call. */
  async getMine(restaurantId: string) {
    const restaurant = await this.requireRestaurant(restaurantId);
    const sub = restaurant.subscription;
    const state = resolveSubscriptionState(sub);
    const productCount = await this.countProducts(restaurant._id);
    // The same answer startCheckout will use, so the screen can never show a
    // price the next request would charge differently.
    const earlyBird = await this.isEarlyBirdPriced(restaurant);

    const settings = await this.systemSettingsService.get();
    const plans = await this.plansService.listSellable();
    const cap = effectiveProductCap(sub, state);
    const renewableFrom =
      state === 'trial' || state === 'active' ? nextPeriodStart(sub) : null;

    return {
      state,
      earlyBird,
      tier: sub?.tier ?? null,
      interval: sub?.interval ?? null,
      planLabel: sub?.planLabelSnapshot ?? null,
      trialEndsAt: sub?.trialEndsAt ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      // When a period bought right now would begin — the same rule onPaid
      // applies, so the screen can only ever promise what actually happens.
      nextPeriodStart: nextPeriodStart(sub),
      // The date the plans they already hold become buyable again. Null while
      // nothing is blocking them, so the screen has no date to explain away.
      renewableFrom,
      productCount,
      productCap: Number.isFinite(cap) ? cap : null,
      plans: plans.map((plan) => ({
        slug: plan.slug,
        label: plan.label,
        productCap: plan.productCap ?? null,
        isCurrent: plan.slug === sub?.tier,
        // The UI highlights the smallest plan that actually fits.
        fitsCurrentCatalogue: productCount <= capValue(plan.productCap),
        intervals: this.buildIntervalOptions(
          plan,
          sub,
          state,
          earlyBird,
          settings.earlyBirdDiscountPercent,
          renewableFrom,
        ),
      })),
    };
  }

  /**
   * The per-interval price block for one plan.
   *
   * `purchasable` mirrors the guard startCheckout enforces, so the screen can
   * never render a button the next request would reject with a 409 — and
   * `blockedReason` gives the merchant the date instead of a dead control.
   */
  private buildIntervalOptions(
    plan: { prices: Record<BillingInterval, number | null>; productCap: number | null },
    sub: any,
    state: ReturnType<typeof resolveSubscriptionState>,
    earlyBird: boolean,
    discountPercent: number,
    renewableFrom: Date | null,
  ) {
    const monthlyPerMonth = perMonthCents(plan as any, 'monthly');

    return BILLING_INTERVALS.reduce(
      (acc, interval) => {
        const priceCents = planPriceCents(
          plan as any,
          interval,
          earlyBird,
          discountPercent,
        );

        if (priceCents === null) {
          acc[interval] = null;
          return acc;
        }

        const { netCents, vatCents } = splitVat(priceCents);
        const perMonth = perMonthCents(plan as any, interval)!;
        const purchasable = canPurchasePlan(
          sub,
          state,
          plan.productCap ?? null,
          interval,
        );

        acc[interval] = {
          priceEGP: priceCents / 100,
          // What they would pay without the early-bird seat, so the screen can
          // show the saving. Null when there is nothing to compare against.
          standardPriceEGP: earlyBird
            ? (plan.prices[interval] as number) / 100
            : null,
          netEGP: netCents / 100,
          vatEGP: vatCents / 100,
          perMonthEGP: perMonth / 100,
          // Saving against paying monthly. Null when monthly is not sold, so
          // there is no baseline to claim a saving against.
          savingPercent:
            monthlyPerMonth && monthlyPerMonth > perMonth
              ? Math.round((1 - perMonth / monthlyPerMonth) * 100)
              : null,
          purchasable,
          blockedReason: purchasable
            ? null
            : `You already have this much capacity until ${renewableFrom?.toDateString() ?? 'the end of your period'}. Choose a longer commitment or a larger plan.`,
        };
        return acc;
      },
      {} as Record<BillingInterval, unknown>,
    );
  }

  async startCheckout(
    userId: string,
    restaurantId: string,
    slug: string,
    interval: BillingInterval,
    method: PaymentMethodEnum,
  ) {
    const restaurant = await this.requireRestaurant(restaurantId);
    const plan = await this.plansService.getBySlug(slug);

    // An archived plan is retired: existing holders keep it to the end of
    // their period, but nobody starts a new one.
    if (plan.archived) {
      throw new ConflictException({
        code: 'PLAN_ARCHIVED',
        message: `The ${plan.label} plan is no longer available. Please choose another plan.`,
      });
    }

    const earlyBird = await this.isEarlyBirdPriced(restaurant);
    const settings = await this.systemSettingsService.get();
    const amountCents = planPriceCents(
      plan,
      interval,
      earlyBird,
      settings.earlyBirdDiscountPercent,
    );

    if (amountCents === null) {
      throw new BadRequestException({
        code: 'INTERVAL_NOT_SOLD',
        message: `The ${plan.label} plan is not sold on a ${INTERVAL_LABEL[interval]} basis. Please choose another billing period.`,
      });
    }

    const productCount = await this.countProducts(restaurant._id);
    const planCap = capValue(plan.productCap);

    // Refuse to sell a plan the merchant already exceeds — they would pay and
    // still be blocked, which is the worst possible outcome.
    if (productCount > planCap) {
      throw new BadRequestException({
        code: 'TIER_TOO_SMALL',
        message: `You have ${productCount} products, which exceeds the ${plan.label} limit of ${plan.productCap}. Remove ${productCount - planCap} products or choose a larger plan.`,
        productCount,
        productCap: plan.productCap,
      });
    }

    // Nothing to buy while the same capacity is already paid for on the same
    // or a longer commitment. Renewal belongs at the end of the period, not
    // stacked on top of it.
    const state = resolveSubscriptionState(restaurant.subscription);
    if (
      !canPurchasePlan(restaurant.subscription, state, plan.productCap, interval)
    ) {
      const availableFrom = nextPeriodStart(restaurant.subscription);
      const heldLabel =
        restaurant.subscription?.planLabelSnapshot ?? 'current plan';
      throw new ConflictException({
        code: 'PLAN_NOT_DUE',
        message:
          state === 'trial'
            ? `Your free trial already gives you these limits until ${availableFrom.toDateString()}. You can buy from then, choose a longer billing period, or move up to a larger plan now.`
            : `Your ${heldLabel} is paid for until ${availableFrom.toDateString()}. You can renew from then, choose a longer billing period, or move up to a larger plan now.`,
        state,
        currentTier: restaurant.subscription?.tier ?? null,
        availableFrom,
      });
    }

    // One checkout at a time. Nothing on the Paymob page stops a merchant
    // going back and starting again, and two completed intentions are two real
    // charges — the second silently buying a month they did not mean to.
    const inFlight = await this.paymentRepository.findOne({
      filters: {
        restaurantId: restaurant._id,
        purpose: PaymentPurposeEnum.SUBSCRIPTION,
        status: PaymentStatusEnum.PENDING,
        createdAt: { $gte: new Date(Date.now() - CHECKOUT_IN_FLIGHT_MS) },
      } as any,
    });
    if (inFlight) {
      throw new ConflictException({
        code: 'PAYMENT_IN_PROGRESS',
        message:
          'You already have a payment in progress. Finish it in the payment window, or wait a few minutes and try again — you have not been charged twice.',
      });
    }

    const user = await this.userRepository.findOne({
      filters: { _id: new Types.ObjectId(userId) },
    });
    if (!user) throw new NotFoundException('User not found');

    const { checkoutUrl } = await this.paymentsService.createPayment({
      purpose: PaymentPurposeEnum.SUBSCRIPTION,
      userId: user._id,
      restaurantId: restaurant._id,
      amountCents,
      method,
      tier: plan.slug,
      interval,
      // Snapshotted so onPaid grants what was bought even if an admin edits
      // the plan while the payment is still settling.
      planLabel: plan.label,
      planProductCap: plan.productCap ?? null,
      billingData: {
        first_name: user.firstName,
        last_name: user.lastName,
        phone_number: user.phone,
        email: user.email,
        street: restaurant.address?.street || 'NA',
        city: restaurant.address?.city || 'Cairo',
        country: 'EGY',
      },
      items: [
        {
          name: `RestoMind ${plan.label} - ${INTERVAL_LABEL[interval]}`,
          amount: amountCents,
          quantity: 1,
        },
      ],
      notificationUrl: `${getApiPublicUrl()}/payments/webhook`,
      redirectionUrl: `${getFrontendUrl()}/dashboard/billing/result`,
      expirationSeconds: 3600,
    });

    return { checkoutUrl };
  }

  /**
   * Grants or revokes one merchant's early-bird seat by hand.
   *
   * Deliberately ignores the cap: the cap governs who claims a seat
   * automatically at onboarding, while this is an admin knowingly making an
   * exception for a named merchant. The count an admin sees on the settings
   * screen includes seats granted this way, so nothing is hidden.
   */
  async setEarlyBird(restaurantId: string, granted: boolean, adminId: string) {
    const restaurant = await this.requireRestaurant(restaurantId);
    const previous = restaurant.subscription?.earlyBird ?? false;

    await this.restaurantRepository.update({
      filters: { _id: restaurant._id },
      body: { 'subscription.earlyBird': granted } as any,
    });

    this.logger.log(
      `Admin ${adminId} ${granted ? 'granted' : 'revoked'} the early-bird price for restaurant ${String(restaurant._id)} (was ${previous})`,
    );

    return {
      restaurantId: String(restaurant._id),
      earlyBird: granted,
      // Whether it is actually being charged, which is not the same thing while
      // the platform switch is off.
      effective: await this.isEarlyBirdPriced({
        subscription: { earlyBird: granted },
      }),
    };
  }

  /**
   * Admin trial override — extend, shorten, or revoke.
   *
   * Logged with the previous value, because "why does this venue have a
   * 90-day trial" is a question someone will eventually ask.
   */
  async setTrial(
    restaurantId: string,
    trialEndsAt: string | null,
    adminId: string,
  ) {
    const restaurant = await this.requireRestaurant(restaurantId);
    const previous = restaurant.subscription?.trialEndsAt ?? null;
    // Null means "revoke now", which the resolver reads as expired.
    const next = trialEndsAt ? new Date(trialEndsAt) : new Date();

    if (Number.isNaN(next.getTime())) {
      throw new BadRequestException('trialEndsAt is not a valid date');
    }

    await this.restaurantRepository.update({
      filters: { _id: restaurant._id },
      body: { 'subscription.trialEndsAt': next } as any,
    });

    this.logger.log(
      `Admin ${adminId} changed trialEndsAt for restaurant ${String(restaurant._id)}: ${previous ? new Date(previous).toISOString() : 'none'} -> ${next.toISOString()}`,
    );

    const updated = await this.requireRestaurant(restaurantId);
    return {
      trialEndsAt: next,
      previousTrialEndsAt: previous,
      state: resolveSubscriptionState(updated.subscription),
    };
  }

  // -------------------------------------------------------------------------
  // PaymentFulfiller
  // -------------------------------------------------------------------------

  /**
   * Idempotent by construction: periodEnd is computed from stored dates and
   * written, never incremented, so re-running with the same payment is safe.
   */
  async onPaid(payment: PaymentType): Promise<void> {
    if (!payment.restaurantId || !payment.tier) {
      this.logger.error(
        `Subscription payment ${String(payment._id)} has no restaurantId/tier — cannot apply`,
      );
      return;
    }

    const restaurant = await this.requireRestaurant(payment.restaurantId);

    const interval: BillingInterval = payment.interval ?? 'monthly';
    const periodStart = nextPeriodStart(restaurant.subscription);
    const periodEnd = addMonths(periodStart, INTERVAL_MONTHS[interval]);

    // Every field comes from the payment's own snapshot, never from the live
    // plan: a payment settling after an admin edits the plan must grant what
    // was bought and paid for, not what the plan happens to say now.
    //
    // trialProductCap is deliberately absent — the trial grant owns it, so a
    // purchase can never shorten or shrink a trial that is still running.
    await this.restaurantRepository.update({
      filters: { _id: restaurant._id },
      body: {
        'subscription.tier': payment.tier,
        'subscription.interval': interval,
        'subscription.productCapSnapshot': payment.planProductCap ?? null,
        'subscription.planLabelSnapshot': payment.planLabel ?? payment.tier,
        'subscription.currentPeriodEnd': periodEnd,
        'subscription.lastPaymentId': payment._id,
      } as any,
    });

    await this.paymentRepository.update({
      filters: { _id: payment._id },
      body: { periodStart, periodEnd } as any,
    });

    this.logger.log(
      `Restaurant ${String(restaurant._id)} subscribed to ${payment.tier} until ${periodEnd.toISOString()}`,
    );
  }

  async onFailed(payment: PaymentType): Promise<void> {
    // Nothing to undo — a failed subscription payment simply leaves the
    // restaurant in whatever state it was already in.
    this.logger.warn(
      `Subscription payment ${String(payment._id)} failed for restaurant ${String(payment.restaurantId)}`,
    );
  }
}
