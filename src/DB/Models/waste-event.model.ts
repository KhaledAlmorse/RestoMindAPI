import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { IngredientUnitEnum, WasteReasonEnum } from 'src/Common/Types';

@Schema({ timestamps: true })
export class WasteEvent {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ingredient', required: true })
  ingredientId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InventoryBatch', default: null })
  batchId?: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  quantity!: number;

  @Prop({
    type: String,
    enum: Object.values(IngredientUnitEnum),
    required: true,
  })
  unit!: IngredientUnitEnum;

  @Prop({
    type: String,
    enum: Object.values(WasteReasonEnum),
    required: true,
  })
  wasteReason!: WasteReasonEnum;

  @Prop({ type: Number, required: true, min: 0 })
  estimatedCost!: number;

  @Prop({ type: Date, required: true, default: Date.now })
  date!: Date;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date;
}

const WasteEventSchema = SchemaFactory.createForClass(WasteEvent);

WasteEventSchema.index({ restaurantId: 1, date: -1 });
WasteEventSchema.index({ ingredientId: 1, date: -1 });
WasteEventSchema.index({ restaurantId: 1, wasteReason: 1 });

export const WasteEventModel = MongooseModule.forFeature([
  { name: WasteEvent.name, schema: WasteEventSchema },
]);

export type WasteEventType = HydratedDocument<WasteEvent> & Document;
