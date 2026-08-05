import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { PaymentMethodEnum, PaymentPurposeEnum } from 'src/Common/Types';
import { addMonths } from 'src/Common/Utils';
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
import {
  TIERS,
  TierName,
  splitVat,
  tierPriceCents,
} from './subscription-tiers.config';
import {
  effectiveProductCap,
  resolveSubscriptionState,
} from './subscription-state';

@Injectable()
export class SubscriptionsService implements PaymentFulfiller, OnModuleInit {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly restaurantRepository: RestaurantRepository,
    private readonly productRepository: ProductRepository,
    private readonly userRepository: UserRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly paymentsService: PaymentsService,
  ) {}

  onModuleInit(): void {
    this.paymentsService.registerFulfiller(
      PaymentPurposeEnum.SUBSCRIPTION,
      this,
    );
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

    return {
      state,
      tier: sub?.tier ?? null,
      trialEndsAt: sub?.trialEndsAt ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      productCount,
      productCap: Number.isFinite(effectiveProductCap(sub, state))
        ? effectiveProductCap(sub, state)
        : null,
      tiers: (Object.keys(TIERS) as TierName[]).map((name) => {
        const priceCents = tierPriceCents(name);
        const { netCents, vatCents } = splitVat(priceCents);
        return {
          name,
          label: TIERS[name].label,
          productCap: Number.isFinite(TIERS[name].productCap)
            ? TIERS[name].productCap
            : null,
          priceEGP: TIERS[name].priceEGP,
          netEGP: netCents / 100,
          vatEGP: vatCents / 100,
          // The UI highlights the smallest tier that actually fits.
          fitsCurrentCatalogue: productCount <= TIERS[name].productCap,
        };
      }),
    };
  }

  async startCheckout(
    userId: string,
    restaurantId: string,
    tier: TierName,
    method: PaymentMethodEnum,
  ) {
    const restaurant = await this.requireRestaurant(restaurantId);
    const productCount = await this.countProducts(restaurant._id);

    // Refuse to sell a plan the merchant already exceeds — they would pay and
    // still be blocked, which is the worst possible outcome.
    if (productCount > TIERS[tier].productCap) {
      throw new BadRequestException({
        code: 'TIER_TOO_SMALL',
        message: `You have ${productCount} products, which exceeds the ${TIERS[tier].label} limit of ${TIERS[tier].productCap}. Remove ${productCount - TIERS[tier].productCap} products or choose a larger plan.`,
        productCount,
        productCap: TIERS[tier].productCap,
      });
    }

    const user = await this.userRepository.findOne({
      filters: { _id: new Types.ObjectId(userId) },
    });
    if (!user) throw new NotFoundException('User not found');

    const amountCents = tierPriceCents(tier);

    const { checkoutUrl } = await this.paymentsService.createPayment({
      purpose: PaymentPurposeEnum.SUBSCRIPTION,
      userId: user._id,
      restaurantId: restaurant._id,
      amountCents,
      method,
      tier,
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
          name: `RestoMind ${TIERS[tier].label} - 1 month`,
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
    const sub = restaurant.subscription;

    // Paying during a trial must not burn the remaining trial days, and an
    // early renewal must extend rather than truncate. Both fall out of max().
    const candidates = [new Date()];
    if (sub?.trialEndsAt) candidates.push(new Date(sub.trialEndsAt));
    if (sub?.currentPeriodEnd) candidates.push(new Date(sub.currentPeriodEnd));
    const periodStart = new Date(
      Math.max(...candidates.map((d) => d.getTime())),
    );
    const periodEnd = addMonths(periodStart, 1);

    await this.restaurantRepository.update({
      filters: { _id: restaurant._id },
      body: {
        'subscription.tier': payment.tier,
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
