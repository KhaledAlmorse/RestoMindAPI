import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Document,
  HydratedDocument,
  Schema as MongooseSchema,
  Types,
} from 'mongoose';

/**
 * Ref fields MUST use `MongooseSchema.Types.ObjectId`, never `Types.ObjectId`.
 *
 * The latter is the BSON value constructor, not a SchemaType: SchemaFactory
 * resolves it to Mixed, which silently disables casting. Every other model
 * survives that because its callers pass `new Types.ObjectId(...)` by hand —
 * CartService passes the raw string userId, so an uncast path stored a STRING
 * here. That produced a second cart per customer (string doc vs seeded
 * ObjectId doc), and `OrdersService.onPaid` emptied the one nobody was
 * reading: the customer paid and their cart stayed full.
 */
@Schema({ _id: false })
export class CartItem {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Offer', required: true })
  offerId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1, default: 1 })
  quantity!: number;
}

@Schema({ timestamps: true })
export class Cart {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  })
  userId!: Types.ObjectId;

  @Prop({ type: [CartItem], default: [] })
  items!: CartItem[];
}

const CartSchema = SchemaFactory.createForClass(Cart);

export const CartModel = MongooseModule.forFeature([
  { name: Cart.name, schema: CartSchema },
]);

export type CartType = HydratedDocument<Cart> & Document;
