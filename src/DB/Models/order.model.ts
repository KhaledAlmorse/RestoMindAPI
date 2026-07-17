import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class OrderItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: Number, required: true })
  price!: number;

  @Prop({ type: Number, required: true })
  discountedPrice!: number;

  @Prop({ type: Number, required: true, min: 1 })
  quantity!: number;
}

@Schema({ timestamps: true })
export class Order {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: [OrderItem], required: true })
  items!: OrderItem[];

  @Prop({ type: Number, required: true })
  totalOriginalPrice!: number;

  @Prop({ type: Number, required: true })
  totalDiscount!: number;

  @Prop({ type: Number, required: true })
  finalTotalPrice!: number;

  @Prop({ type: Number, required: true })
  totalQuantity!: number;

  @Prop({ type: String, enum: ['CASH'], default: 'CASH', required: true })
  paymentMethod!: string;

  @Prop({
    type: String,
    enum: [
      'Pending',
      'Confirmed',
      'Preparing',
      'Out For Delivery',
      'Delivered',
      'Cancelled',
    ],
    default: 'Pending',
    required: true,
  })
  status!: string;
}

const OrderSchema = SchemaFactory.createForClass(Order);

export const OrderModel = MongooseModule.forFeature([
  { name: Order.name, schema: OrderSchema },
]);

export type OrderType = HydratedDocument<Order> & Document;
