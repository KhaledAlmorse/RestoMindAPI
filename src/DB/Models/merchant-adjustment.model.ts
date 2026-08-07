import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

/**
 * A signed correction to a merchant's balance with no order behind it: a
 * chargeback that landed after payout, a goodwill credit, commission collected
 * on cash sales, a fix for a settlement error.
 *
 * This model exists so that ops never has a reason to edit an order or a
 * payout by hand. Every movement stays attributable to someone.
 */
@Schema({ timestamps: true })
export class MerchantAdjustment {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  /** Signed piasters. Positive credits the merchant, negative debits them. */
  @Prop({ type: Number, required: true })
  amountCents!: number;

  @Prop({ type: String, required: true })
  reason!: string;

  /**
   * Which statement this falls into. Defaults to now; backdating before the
   * merchant's paid-through mark is rejected in the service, because it would
   * land in a period that has already been settled.
   */
  @Prop({ type: Date, required: true, default: Date.now })
  effectiveAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;
}

const MerchantAdjustmentSchema =
  SchemaFactory.createForClass(MerchantAdjustment);

MerchantAdjustmentSchema.index({ restaurantId: 1, effectiveAt: 1 });

export const MerchantAdjustmentModel = MongooseModule.forFeature([
  { name: MerchantAdjustment.name, schema: MerchantAdjustmentSchema },
]);

export type MerchantAdjustmentType = HydratedDocument<MerchantAdjustment> &
  Document;
