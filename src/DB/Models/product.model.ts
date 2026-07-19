import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import slugify from 'slugify';
import { Category } from './category.model';

@Schema({ timestamps: true })
export class Product {
  @Prop({
    type: String,
    required: true,
  })
  title!: string;

  @Prop({
    type: String,
    required: true,
    unique: true,
    index: true,
  })
  slug!: string;

  @Prop({ type: String, required: true })
  description!: string;

  @Prop({ type: String, required: true })
  longDescription!: string;

  @Prop({ type: Number, required: true, min: 0 })
  price!: number;

  @Prop({ type: Number, required: true, min: 0 })
  discountedPrice!: number;

  @Prop({ type: Number, default: 0, min: 0, max: 5 })
  rating!: number;

  @Prop({ type: Number, default: 0 })
  reviewsCount!: number;

  @Prop({ type: Boolean, default: false })
  isBestseller!: boolean;

  @Prop({ type: Boolean, default: true })
  isAvailable!: boolean;

  @Prop({
    type: {
      public_id: { type: String, required: true },
      secure_url: { type: String, required: true },
    },
    _id: false,
    required: true,
  })
  image!: {
    public_id: string;
    secure_url: string;
  };

  @Prop({ type: Types.ObjectId, ref: 'Category', required: true })
  category!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  freshnessWindow!: number;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;
}

const ProductSchema = SchemaFactory.createForClass(Product);
ProductSchema.index({ restaurantId: 1, title: 1 }, { unique: true });

export const ProductModel = MongooseModule.forFeature([
  { name: Product.name, schema: ProductSchema },
]);

export type ProductType = HydratedDocument<Product> & Document;
