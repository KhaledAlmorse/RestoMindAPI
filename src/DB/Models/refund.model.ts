import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { RefundSettlementModeEnum, RefundStatusEnum } from 'src/Common/Types';

/**
 * A single refund against a Payment. Many refunds can exist per payment — a
 * group order spans several restaurants but is paid in one Paymob
 * transaction, so a per-restaurant refund is a partial against that
 * transaction.
 *
 * The "customer asked, staff hasn't approved yet" case is the REQUESTED
 * status rather than a separate model.
 */
@Schema({ timestamps: true })
export class Refund {
  /**
   * Null for a cash-on-delivery refund: there is no gateway payment to refund
   * against, only cash to hand back. Required would make every COD refund fail
   * validation before the row ever existed.
   */
  @Prop({ type: Types.ObjectId, ref: 'Payment', required: false })
  paymentId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'OrderGroup', required: true })
  orderGroupId!: Types.ObjectId;

  /** Null means the whole group. */
  @Prop({ type: Types.ObjectId, ref: 'Order', required: false })
  orderId?: Types.ObjectId;

  /** Null means the whole order. Indexes into Order.items. */
  @Prop({ type: [Number], required: false, default: undefined })
  lineItemIndexes?: number[];

  @Prop({ type: Number, required: true, min: 1 })
  amountCents!: number;

  @Prop({ type: String, required: true })
  reason!: string;

  /** OFFLINE (cash on delivery) never calls the gateway. */
  @Prop({
    type: String,
    enum: Object.values(RefundSettlementModeEnum),
    required: true,
  })
  settlementMode!: RefundSettlementModeEnum;

  @Prop({
    type: String,
    enum: Object.values(RefundStatusEnum),
    required: true,
    default: RefundStatusEnum.REQUESTED,
  })
  status!: RefundStatusEnum;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  initiatedBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: Date, required: false })
  reviewedAt?: Date;

  @Prop({ type: String, required: false })
  rejectionReason?: string;

  @Prop({ type: String, enum: ['refund', 'void'], required: false })
  gatewayOperation?: 'refund' | 'void';

  @Prop({ type: Number, required: false })
  paymobRefundTransactionId?: number;

  /** Stored verbatim so a gateway failure is never silently lost. */
  @Prop({ type: String, required: false })
  gatewayError?: string;

  @Prop({ type: Date, required: false })
  completedAt?: Date;

  /**
   * Whether the order(s) behind this refund had already been delivered when
   * the refund was created. Lets an OFFLINE (cash-on-delivery) refund know
   * whether cash was ever actually collected, without PaymentsService
   * depending on OrdersService/OrderRepository (payments.module.ts documents
   * that this module must stay independent of OrdersModule to avoid a
   * circular fulfiller-registry dependency).
   * Undefined means "unknown / not set by this code path" and must be
   * treated the same as `true` (assume cash was collected) — never treated
   * as `false`.
   */
  @Prop({ type: Boolean, required: false })
  orderWasDelivered?: boolean;
}

const RefundSchema = SchemaFactory.createForClass(Refund);

RefundSchema.index({ paymentId: 1, status: 1 });
RefundSchema.index({ orderGroupId: 1 });
RefundSchema.index({ status: 1, createdAt: 1 }); // reconciliation scan

export const RefundModel = MongooseModule.forFeature([
  { name: Refund.name, schema: RefundSchema },
]);

export type RefundType = HydratedDocument<Refund> & Document;
