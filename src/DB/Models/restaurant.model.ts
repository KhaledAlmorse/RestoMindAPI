import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Restaurant {
  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false, default: null })
  ownerUserId?: Types.ObjectId | null;

  @Prop({ type: String, required: false })
  description?: string;

  @Prop({
    type: {
      public_id: { type: String, required: true },
      secure_url: { type: String, required: true },
    },
    _id: false,
    required: false,
  })
  image?: {
    public_id: string;
    secure_url: string;
  };

  @Prop({ type: String, required: false })
  phone?: string;

  @Prop({
    type: {
      street: { type: String, required: false },
      city: { type: String, required: false },
      district: { type: String, required: false },
      country: { type: String, required: false },
    },
    _id: false,
    required: false,
  })
  address?: {
    street?: string;
    city?: string;
    district?: string;
    country?: string;
  };

  /**
   * Billing state. Deliberately holds no `status` field — status is derived
   * by resolveSubscriptionState() so it can never go stale between cron ticks.
   */
  @Prop({
    type: {
      // No enum: plans are admin-managed, so a slug this schema has never
      // heard of must still be writable. An enum here would reject the write
      // AFTER the merchant had already paid.
      tier: { type: String, required: false },
      interval: {
        type: String,
        enum: ['monthly', 'halfYearly', 'yearly'],
        required: false,
      },
      currentPeriodEnd: { type: Date, required: false },
      trialEndsAt: { type: Date, required: false },
      lastPaymentId: { type: Types.ObjectId, ref: 'Payment', required: false },
      earlyBird: { type: Boolean, required: false },
      productCapSnapshot: { type: Number, required: false, default: undefined },
      planLabelSnapshot: { type: String, required: false },
      trialProductCap: { type: Number, required: false, default: undefined },
    },
    _id: false,
    required: false,
  })
  subscription?: {
    /** A SubscriptionPlan slug. */
    tier?: string;
    interval?: 'monthly' | 'halfYearly' | 'yearly';
    currentPeriodEnd?: Date;
    trialEndsAt?: Date;
    lastPaymentId?: Types.ObjectId;
    /**
     * Holds an early-bird seat. Granted once — automatically at onboarding
     * while seats remain, or by an admin for a specific merchant — and then
     * never recomputed, so the price cannot drift as other merchants sign up.
     * It only takes effect while the platform switch is on.
     */
    earlyBird?: boolean;
    /**
     * The cap actually purchased, snapshotted so enforcement needs no plan
     * lookup on the product-create path and an admin editing a plan cannot
     * shrink a merchant who has already paid.
     *
     * `null` means unlimited; absent means never set. The distinction is
     * load-bearing — see effectiveProductCap().
     */
    productCapSnapshot?: number | null;
    /** So an archived or renamed plan still displays correctly. */
    planLabelSnapshot?: string;
    /** Owned by the trial grant. A purchase never writes this. */
    trialProductCap?: number | null;
  };

  /**
   * Marketplace commission as a fraction of the order total, VAT-inclusive,
   * matching the subscription pricing convention. Optional: unset means the
   * platform default applies. Changing this affects only orders created
   * afterwards — every Order snapshots the rate it was sold under.
   */
  @Prop({ type: Number, required: false, min: 0, max: 1 })
  commissionRate?: number;

  /**
   * Where a manual payout is sent. Absent means payouts are blocked for this
   * merchant — the statement is still produced, with a blocking reason, so
   * nobody discovers the missing IBAN on transfer day.
   */
  @Prop({
    type: {
      method: { type: String, enum: ['bank', 'wallet'], required: true },
      accountName: { type: String, required: true },
      accountNumber: { type: String, required: true },
      bankName: { type: String, required: false },
    },
    _id: false,
    required: false,
  })
  payoutDestination?: {
    method: 'bank' | 'wallet';
    accountName: string;
    accountNumber: string;
    bankName?: string;
  };

  /**
   * Closing time as a Cairo wall-clock hour, 0–23. Drives the surplus scan:
   * the AI service sizes an end-of-day discount from how much selling time is
   * left before this hour, so a bakery closing at 18:00 given the old
   * hardcoded 22 had its discounts fire hours after anyone could act on them.
   *
   * Optional. Unset means the platform default (DEFAULT_CLOSE_HOUR) applies,
   * so existing restaurants keep their current behaviour without a migration.
   */
  @Prop({ type: Number, required: false, min: 0, max: 23 })
  closeHour?: number;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;

  @Prop({ type: Date })
  deletedAt?: Date;
}

const RestaurantSchema = SchemaFactory.createForClass(Restaurant);

RestaurantSchema.index(
  { ownerUserId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

RestaurantSchema.index(
  { name: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

// The offer-suspension cron scans by subscription dates every 5 minutes.
RestaurantSchema.index({ 'subscription.currentPeriodEnd': 1 });
RestaurantSchema.index({ 'subscription.trialEndsAt': 1 });

export const RestaurantModel = MongooseModule.forFeature([
  { name: Restaurant.name, schema: RestaurantSchema },
]);

export type RestaurantType = HydratedDocument<Restaurant> & Document;
