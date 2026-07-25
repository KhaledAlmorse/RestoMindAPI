import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class InventoryBatch {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ingredient', required: true })
  ingredientId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  batchNumber!: string;

  @Prop({ type: Number, required: true, min: 0 })
  quantityRemaining!: number;

  @Prop({ type: Number, required: true, min: 0 })
  unitCost!: number;

  @Prop({ type: Date, required: true })
  expiryDate!: Date;

  @Prop({ type: Date, required: true, default: Date.now })
  receivedDate!: Date;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date;
}

const InventoryBatchSchema = SchemaFactory.createForClass(InventoryBatch);

InventoryBatchSchema.index({ restaurantId: 1, isDeleted: 1 });
InventoryBatchSchema.index({ ingredientId: 1, expiryDate: 1 });
InventoryBatchSchema.index({ restaurantId: 1, ingredientId: 1, isDeleted: 1 });

export const InventoryBatchModel = MongooseModule.forFeature([
  { name: InventoryBatch.name, schema: InventoryBatchSchema },
]);

export type InventoryBatchType = HydratedDocument<InventoryBatch> & Document;
