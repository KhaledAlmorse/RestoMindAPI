import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { IngredientUnitEnum, StockTransactionTypeEnum } from 'src/Common/Types';

@Schema({ timestamps: true })
export class StockTransaction {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ingredient', required: true })
  ingredientId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InventoryBatch', default: null })
  batchId?: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(StockTransactionTypeEnum),
    required: true,
  })
  transactionType!: StockTransactionTypeEnum;

  @Prop({ type: Number, required: true, min: 0 })
  quantity!: number;

  @Prop({
    type: String,
    enum: Object.values(IngredientUnitEnum),
    required: true,
  })
  unit!: IngredientUnitEnum;

  @Prop({ type: Date, required: true, default: Date.now })
  date!: Date;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date;
}

const StockTransactionSchema = SchemaFactory.createForClass(StockTransaction);

StockTransactionSchema.index({ restaurantId: 1, date: -1 });
StockTransactionSchema.index({ ingredientId: 1, date: -1 });
StockTransactionSchema.index({ restaurantId: 1, transactionType: 1 });

export const StockTransactionModel = MongooseModule.forFeature([
  { name: StockTransaction.name, schema: StockTransactionSchema },
]);

export type StockTransactionType = HydratedDocument<StockTransaction> &
  Document;
