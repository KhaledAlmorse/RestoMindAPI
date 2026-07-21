import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Document,
  HydratedDocument,
  Types,
  Schema as MongooseSchema,
} from 'mongoose';

@Schema({ _id: false })
export class OrderItem {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Offer', required: true })
  offerId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  productTitle!: string;

  @Prop({ type: String, required: false })
  productImage?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Restaurant',
    required: true,
  })
  restaurantId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  restaurantName!: string;

  @Prop({ type: Number, required: true })
  originalPrice!: number;

  @Prop({ type: Number, required: true })
  offerPrice!: number;

  @Prop({ type: Number, required: true })
  discountPercentage!: number;

  @Prop({ type: Number, required: true, min: 1 })
  quantity!: number;

  @Prop({ type: Date, required: true, default: Date.now })
  purchasedAt!: Date;

  @Prop({ type: Number, required: true })
  lineTotal!: number;
}

@Schema({ timestamps: true })
export class Order {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'OrderGroup',
    required: false,
  })
  groupOrderId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Restaurant',
    required: true,
  })
  restaurantId!: Types.ObjectId;

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

  @Prop({ type: String, required: true })
  fullName!: string;

  @Prop({ type: String, required: true })
  phoneNumber!: string;

  @Prop({ type: String, required: true })
  emailAddress!: string;

  @Prop({
    type: String,
    enum: ['Home Delivery', 'Store Pickup'],
    required: true,
  })
  deliveryMethod!: string;

  @Prop({
    type: {
      addressId: { type: String, required: false },
      street: { type: String, required: true },
      city: { type: String, required: true },
      country: { type: String, required: true },
    },
    _id: false,
    required: false,
  })
  deliveryAddress?: {
    addressId?: string;
    street: string;
    city: string;
    country: string;
  };

  @Prop({ type: String, required: false })
  specialNotes?: string;

  @Prop({
    type: String,
    enum: ['Cash on Delivery'],
    default: 'Cash on Delivery',
    required: true,
  })
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
