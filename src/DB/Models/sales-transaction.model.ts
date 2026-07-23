import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { SalesSourceEnum } from 'src/Common/Types';

@Schema({ timestamps: true })
export class SalesTransaction {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ type: Date, required: true, default: Date.now })
  date!: Date;

  @Prop({ type: Number, required: true, min: 1 })
  quantitySold!: number;

  @Prop({ type: Number, required: true, min: 0 })
  basePrice!: number;

  @Prop({ type: Number, required: true, min: 0 })
  sellingPrice!: number;

  @Prop({ type: Boolean, default: false })
  promotionActive!: boolean;

  @Prop({ type: Boolean, default: false })
  featured!: boolean;

  @Prop({ type: Number, default: 0, min: 0 })
  stockoutMinutes!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  cancelledOrders!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  returnedOrders!: number;

  @Prop({ type: String, default: 'marketplace' })
  salesChannel!: string;

  @Prop({
    type: String,
    enum: Object.values(SalesSourceEnum),
    required: true,
  })
  source!: SalesSourceEnum;

  @Prop({ type: Types.ObjectId, ref: 'ImportJob', default: null })
  importJobId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', default: null })
  orderId?: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;
}

const SalesTransactionSchema = SchemaFactory.createForClass(SalesTransaction);

SalesTransactionSchema.index({ restaurantId: 1, date: -1 });
SalesTransactionSchema.index({ productId: 1, date: -1 });
SalesTransactionSchema.index({ restaurantId: 1, productId: 1, date: -1 });
SalesTransactionSchema.index({ source: 1 });
SalesTransactionSchema.index({ orderId: 1 });

export const SalesTransactionModel = MongooseModule.forFeature([
  { name: SalesTransaction.name, schema: SalesTransactionSchema },
]);

export type SalesTransactionType = HydratedDocument<SalesTransaction> &
  Document;
