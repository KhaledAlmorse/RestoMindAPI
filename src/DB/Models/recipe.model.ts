import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { IngredientUnitEnum } from 'src/Common/Types';

@Schema({ _id: false })
export class RecipeIngredient {
  @Prop({ type: Types.ObjectId, ref: 'Ingredient', required: true })
  ingredientId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  quantityPerPortion!: number;

  @Prop({
    type: String,
    enum: Object.values(IngredientUnitEnum),
    required: true,
  })
  unit!: IngredientUnitEnum;

  @Prop({ type: Number, default: 100, min: 0, max: 100 })
  yieldPercentage!: number;
}

const RecipeIngredientSchema = SchemaFactory.createForClass(RecipeIngredient);

@Schema({ timestamps: true })
export class Recipe {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, unique: true })
  productId!: Types.ObjectId;

  @Prop({ type: [RecipeIngredientSchema], required: true, default: [] })
  ingredients!: RecipeIngredient[];

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date;
}

const RecipeSchema = SchemaFactory.createForClass(Recipe);
RecipeSchema.index(
  { productId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
RecipeSchema.index({ restaurantId: 1, isDeleted: 1 });

export const RecipeModel = MongooseModule.forFeature([
  { name: Recipe.name, schema: RecipeSchema },
]);

export type RecipeType = HydratedDocument<Recipe> & Document;
