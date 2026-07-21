import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Document,
  HydratedDocument,
  Types,
  Schema as MongooseSchema,
} from 'mongoose';

@Schema({ timestamps: true })
export class OrderGroup {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Order' }],
    required: true,
  })
  orderIds!: Types.ObjectId[];

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

  @Prop({ type: Number, required: true })
  totalOriginalPrice!: number;

  @Prop({ type: Number, required: true })
  totalDiscount!: number;

  @Prop({ type: Number, required: true })
  finalTotalPrice!: number;

  @Prop({ type: Number, required: true })
  totalQuantity!: number;
}

const OrderGroupSchema = SchemaFactory.createForClass(OrderGroup);

export const OrderGroupModel = MongooseModule.forFeature([
  { name: OrderGroup.name, schema: OrderGroupSchema },
]);

export type OrderGroupType = HydratedDocument<OrderGroup> & Document;
