import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { PayoutDirectionEnum, PayoutStatusEnum } from 'src/Common/Types';

/**
 * A settlement that actually happened, in either direction. Immutable once
 * COMPLETED — corrections are MerchantAdjustment rows, never edits, so the
 * record of what was transferred always matches the bank.
 *
 * `periodEnd` is the merchant's paid-through mark: the next statement's window
 * starts here. That single fact is what makes late refunds land in the next
 * period instead of silently rewriting a statement that has been paid.
 */
@Schema({ timestamps: true })
export class Payout {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  /** Inclusive. The previous completed payout's periodEnd, or epoch. */
  @Prop({ type: Date, required: true })
  periodStart!: Date;

  /** Exclusive. Cairo-anchored end of the settled period. */
  @Prop({ type: Date, required: true })
  periodEnd!: Date;

  /** Always positive; `direction` carries the sign. Integer piasters. */
  @Prop({ type: Number, required: true, min: 1 })
  amountCents!: number;

  @Prop({
    type: String,
    enum: Object.values(PayoutDirectionEnum),
    required: true,
  })
  direction!: PayoutDirectionEnum;

  /**
   * The statement lines exactly as they stood when this was paid. Snapshotted
   * rather than re-derived: source rows can be corrected later, and a payout
   * must still be able to show what it was actually based on.
   */
  @Prop({ type: [Object], required: true })
  lines!: Record<string, any>[];

  @Prop({ type: Number, required: true, default: 0 })
  commissionNetCents!: number;

  @Prop({ type: Number, required: true, default: 0 })
  commissionVatCents!: number;

  /** Bank transfer reference or wallet transaction id, entered by ops. */
  @Prop({ type: String, required: false })
  reference?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recordedBy!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(PayoutStatusEnum),
    required: true,
    default: PayoutStatusEnum.PENDING,
  })
  status!: PayoutStatusEnum;

  @Prop({ type: Date, required: false })
  completedAt?: Date;

  @Prop({ type: String, required: false })
  failureReason?: string;
}

const PayoutSchema = SchemaFactory.createForClass(Payout);

/**
 * One settlement per merchant per period end — the guard against paying the
 * same statement twice. Partial rather than plain unique so a FAILED payout
 * can be retried for the same period without a manual cleanup.
 */
PayoutSchema.index(
  { restaurantId: 1, periodEnd: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [PayoutStatusEnum.PENDING, PayoutStatusEnum.COMPLETED] },
    },
  },
);
// Resolving the paid-through mark: newest completed payout for a merchant.
PayoutSchema.index({ restaurantId: 1, status: 1, periodEnd: -1 });

export const PayoutModel = MongooseModule.forFeature([
  { name: Payout.name, schema: PayoutSchema },
]);

export type PayoutType = HydratedDocument<Payout> & Document;
