import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { IngredientUnitEnum } from 'src/Common/Types';

@Schema({ timestamps: true })
export class Ingredient {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  ingredientCode!: string;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({
    type: String,
    enum: Object.values(IngredientUnitEnum),
    required: true,
  })
  unit!: IngredientUnitEnum;

  @Prop({ type: Number, required: true, min: 0 })
  shelfLifeDays!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  minimumStock!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  safetyStock!: number;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date;
}

const IngredientSchema = SchemaFactory.createForClass(Ingredient);
IngredientSchema.index({ restaurantId: 1, ingredientCode: 1, isDeleted: 1 });
IngredientSchema.index({ restaurantId: 1, isDeleted: 1 });

export const IngredientModel = MongooseModule.forFeature([
  { name: Ingredient.name, schema: IngredientSchema },
]);

export type IngredientType = HydratedDocument<Ingredient> & Document;
