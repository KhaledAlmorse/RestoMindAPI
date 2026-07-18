import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Restaurant {
  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  ownerUserId!: Types.ObjectId;

  @Prop({ type: String, required: false })
  description?: string;

  @Prop({ type: String, required: false })
  logoUrl?: string;

  @Prop({ type: String, required: false })
  phone?: string;

  @Prop({
    type: {
      street: { type: String, required: false },
      city: { type: String, required: false },
      country: { type: String, required: false },
    },
    _id: false,
    required: false,
  })
  address?: {
    street?: string;
    city?: string;
    country?: string;
  };

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;

  @Prop({ type: Date })
  deletedAt?: Date;
}

const RestaurantSchema = SchemaFactory.createForClass(Restaurant);

export const RestaurantModel = MongooseModule.forFeature([
  { name: Restaurant.name, schema: RestaurantSchema },
]);

export type RestaurantType = HydratedDocument<Restaurant> & Document;
