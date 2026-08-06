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
  TIERS,
  TierName,
  tierPriceCents,
} from './subscription-tiers.config';
import {
  canPurchaseTier,
  effectiveProductCap,
  effectiveTier,
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

      const trialEndsAt = addDays(new Date(), settings.trialDurationDays);
      const result = await this.restaurantRepository.updateMany(
        {
          isDeleted: { $ne: true },
          'subscription.trialEndsAt': { $exists: false },
          'subscription.currentPeriodEnd': { $exists: false },
        },
        { $set: { 'subscription.trialEndsAt': trialEndsAt } },
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

    return {
      state,
      earlyBird,
      tier: sub?.tier ?? null,
      trialEndsAt: sub?.trialEndsAt ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      // When a month bought right now would begin — the same rule onPaid
      // applies, so the screen can only ever promise what actually happens.
      nextPeriodStart: nextPeriodStart(sub),
      // The date the plans they already hold become buyable again. Null while
      // nothing is blocking them, so the screen has no date to explain away.
      renewableFrom:
        state === 'trial' || state === 'active' ? nextPeriodStart(sub) : null,
      productCount,
      productCap: Number.isFinite(effectiveProductCap(sub, state))
        ? effectiveProductCap(sub, state)
        : null,
      tiers: (Object.keys(TIERS) as TierName[]).map((name) => {
        const priceCents = tierPriceCents(name, earlyBird);
        const { netCents, vatCents } = splitVat(priceCents);
        return {
          name,
          label: TIERS[name].label,
          productCap: Number.isFinite(TIERS[name].productCap)
            ? TIERS[name].productCap
            : null,
          priceEGP: priceCents / 100,
          // What they would pay without the early-bird seat, so the screen can
          // show the saving. Null when there is nothing to compare against.
          standardPriceEGP: earlyBird ? TIERS[name].priceEGP : null,
          netEGP: netCents / 100,
          vatEGP: vatCents / 100,
          // The UI highlights the smallest tier that actually fits.
          fitsCurrentCatalogue: productCount <= TIERS[name].productCap,
          // Same rule startCheckout enforces, so the screen never offers a
          // button that the next request would reject.
          purchasable: canPurchaseTier(sub, name),
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

    // Nothing to buy while the same capacity is already paid for or running
    // on trial. Renewal belongs at the end of the period, not stacked on top
    // of it, and a downgrade bought today cannot take effect until then either.
    if (!canPurchaseTier(restaurant.subscription, tier)) {
      const state = resolveSubscriptionState(restaurant.subscription);
      const availableFrom = nextPeriodStart(restaurant.subscription);
      const held = effectiveTier(restaurant.subscription, state);
      throw new ConflictException({
        code: 'PLAN_NOT_DUE',
        message:
          state === 'trial'
            ? `Your free trial already gives you ${TIERS[held!].label} limits until ${availableFrom.toDateString()}. You can buy this plan from then, or move up to a larger one now.`
            : `Your ${TIERS[held!].label} plan is paid for until ${availableFrom.toDateString()}. You can renew from then, or move up to a larger plan now.`,
        state,
        currentTier: held,
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

    const amountCents = tierPriceCents(
      tier,
      await this.isEarlyBirdPriced(restaurant),
    );

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

    const periodStart = nextPeriodStart(restaurant.subscription);
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
