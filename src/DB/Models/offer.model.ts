import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { OfferStatusEnum, OfferSourceEnum } from 'src/Common/Types';

@Schema({ timestamps: true })
export class Offer {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  originalPrice!: number;

  @Prop({ type: Number, required: true })
  offerPrice!: number;

  @Prop({ type: Number, required: true, min: 1, max: 100 })
  discountPercentage!: number;

  @Prop({ type: Number, required: true, min: 1 })
  availableQuantity!: number;

  @Prop({ type: Number, required: true, min: 0 })
  remainingQuantity!: number;

  @Prop({ type: Number, default: null })
  maxPerCustomer?: number;

  @Prop({ type: Date, required: true })
  startDate!: Date;

  @Prop({ type: Date, required: true })
  endDate!: Date;

  @Prop({
    type: String,
    enum: Object.values(OfferStatusEnum),
    required: true,
  })
  status!: OfferStatusEnum;

  @Prop({
    type: String,
    enum: Object.values(OfferSourceEnum),
    required: true,
  })
  source!: OfferSourceEnum;

  @Prop({ type: Types.ObjectId, ref: 'Recommendation', default: null })
  recommendationId?: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  featured!: boolean;

  @Prop({ type: Number, default: null })
  estimatedWasteReduction?: number;

  @Prop({ type: Number, default: null })
  estimatedRevenueRecovery?: number;

  @Prop({ type: Number, default: null })
  actualUnitsSold?: number;

  @Prop({ type: Number, default: null })
  actualRevenueRecovered?: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;
}

const OfferSchema = SchemaFactory.createForClass(Offer);
OfferSchema.index({ productId: 1, status: 1 });
OfferSchema.index({ restaurantId: 1, status: 1 });
OfferSchema.index({ status: 1, startDate: 1 });
OfferSchema.index({ status: 1, endDate: 1 });

export const OfferModel = MongooseModule.forFeature([
  { name: Offer.name, schema: OfferSchema },
]);

export type OfferType = HydratedDocument<Offer> & Document;
