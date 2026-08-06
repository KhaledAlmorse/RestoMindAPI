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
      tier: { type: String, enum: ['basic', 'plus', 'scale'], required: false },
      currentPeriodEnd: { type: Date, required: false },
      trialEndsAt: { type: Date, required: false },
      lastPaymentId: { type: Types.ObjectId, ref: 'Payment', required: false },
      earlyBird: { type: Boolean, required: false },
    },
    _id: false,
    required: false,
  })
  subscription?: {
    tier?: 'basic' | 'plus' | 'scale';
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
