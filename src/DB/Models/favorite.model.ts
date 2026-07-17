import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Favorite {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;
}

const FavoriteSchema = SchemaFactory.createForClass(Favorite);

// Compound unique index to prevent duplicate favorites
FavoriteSchema.index({ userId: 1, productId: 1 }, { unique: true });

export const FavoriteModel = MongooseModule.forFeature([
  { name: Favorite.name, schema: FavoriteSchema },
]);

export type FavoriteType = HydratedDocument<Favorite> & Document;
