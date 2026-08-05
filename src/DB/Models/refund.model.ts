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
  @Prop({ type: Types.ObjectId, ref: 'Payment', required: true })
  paymentId!: Types.ObjectId;

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
}

const RefundSchema = SchemaFactory.createForClass(Refund);

RefundSchema.index({ paymentId: 1, status: 1 });
RefundSchema.index({ orderGroupId: 1 });
RefundSchema.index({ status: 1, createdAt: 1 }); // reconciliation scan

export const RefundModel = MongooseModule.forFeature([
  { name: Refund.name, schema: RefundSchema },
]);

export type RefundType = HydratedDocument<Refund> & Document;
