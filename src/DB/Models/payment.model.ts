import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import {
  PaymentMethodEnum,
  PaymentPurposeEnum,
  PaymentStatusEnum,
} from 'src/Common/Types';

/**
 * One row per payment attempt against Paymob, for both subscription and order
 * payments. The gateway mechanics are identical for the two, and that is where
 * all the complexity lives — `purpose` plus the two optional target refs is
 * what keeps the domain linkage clear without duplicating the hard part.
 */
@Schema({ timestamps: true })
export class Payment {
  @Prop({
    type: String,
    enum: Object.values(PaymentPurposeEnum),
    required: true,
  })
  purpose!: PaymentPurposeEnum;

  /** Set when purpose === SUBSCRIPTION. */
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: false })
  restaurantId?: Types.ObjectId;

  /** Set when purpose === ORDER. */
  @Prop({ type: Types.ObjectId, ref: 'OrderGroup', required: false })
  orderGroupId?: Types.ObjectId;

  /** Who is paying — the restaurant owner, or the customer. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  /** Integer piasters. 300 EGP === 30000. Never a float. */
  @Prop({ type: Number, required: true, min: 1 })
  amountCents!: number;

  @Prop({ type: String, required: true, default: 'EGP' })
  currency!: string;

  @Prop({
    type: String,
    enum: Object.values(PaymentMethodEnum),
    required: true,
  })
  method!: PaymentMethodEnum;

  @Prop({ type: Number, required: true })
  integrationId!: number;

  @Prop({ type: String, required: false })
  intentionId?: string;

  @Prop({ type: String, required: false })
  clientSecret?: string;

  /** Paymob's order id (`intention_order_id`, echoed as `obj.order.id`). */
  @Prop({ type: Number, required: false })
  paymobOrderId?: number;

  /** Paymob's transaction id (`obj.id`). Unique — the idempotency key. */
  @Prop({ type: Number, required: false })
  paymobTransactionId?: number;

  /** Our own id, sent as `special_reference`, echoed as `merchant_order_id`. */
  @Prop({ type: String, required: true })
  specialReference!: string;

  @Prop({
    type: String,
    enum: Object.values(PaymentStatusEnum),
    default: PaymentStatusEnum.PENDING,
    required: true,
  })
  status!: PaymentStatusEnum;

  /**
   * Sum of refunds reserved against this payment, in piasters. Guarded by a
   * single-document conditional $inc so it can never exceed amountCents.
   *
   * Single-document because this codebase's `runTransaction` is not actually
   * transactional (no repository method accepts a session), so no money-path
   * invariant may depend on multi-document atomicity.
   */
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  refundedAmountCents!: number;

  @Prop({ type: Date, required: false })
  hmacVerifiedAt?: Date;

  /** Raw verified callback, stored once for support and dispute evidence. */
  @Prop({ type: Object, required: false })
  gatewayPayload?: Record<string, any>;

  // --- subscription-only fields ---

  /** A SubscriptionPlan slug. */
  @Prop({ type: String, required: false })
  tier?: string;

  @Prop({
    type: String,
    enum: ['monthly', 'halfYearly', 'yearly'],
    required: false,
  })
  interval?: 'monthly' | 'halfYearly' | 'yearly';

  /**
   * What the plan looked like at the moment of purchase.
   *
   * onPaid writes the restaurant's entitlement from these, never from the live
   * plan: a payment that settles after an admin edits the plan must grant what
   * was bought, not what the plan says now. `planProductCap: null` is
   * unlimited, matching SubscriptionPlan.productCap.
   */
  @Prop({ type: String, required: false })
  planLabel?: string;

  @Prop({ type: Number, required: false, default: undefined })
  planProductCap?: number | null;

  @Prop({ type: Date, required: false })
  periodStart?: Date;

  @Prop({ type: Date, required: false })
  periodEnd?: Date;
}

const PaymentSchema = SchemaFactory.createForClass(Payment);

// Idempotency: a retried webhook for the same transaction must not double-apply.
PaymentSchema.index({ paymobTransactionId: 1 }, { unique: true, sparse: true });
PaymentSchema.index({ paymobOrderId: 1 }, { sparse: true });
PaymentSchema.index({ specialReference: 1 });
PaymentSchema.index({ status: 1, createdAt: 1 }); // reconciliation sweep
PaymentSchema.index({ orderGroupId: 1 }, { sparse: true });
PaymentSchema.index({ restaurantId: 1, createdAt: -1 }, { sparse: true });

export const PaymentModel = MongooseModule.forFeature([
  { name: Payment.name, schema: PaymentSchema },
]);

export type PaymentType = HydratedDocument<Payment> & Document;
