import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { ConfidenceLevelEnum, ProductionPlanSourceEnum } from 'src/Common/Types';

@Schema({ _id: false })
export class ProductionPlanItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  recommendedQty!: number;

  @Prop({ type: Number, default: 0 })
  lowerBound?: number;

  @Prop({ type: Number, default: 0 })
  upperBound?: number;

  @Prop({
    type: String,
    enum: Object.values(ConfidenceLevelEnum),
    default: ConfidenceLevelEnum.MEDIUM,
  })
  confidence!: ConfidenceLevelEnum;

  @Prop({
    type: String,
    enum: Object.values(ProductionPlanSourceEnum),
    required: true,
  })
  source!: ProductionPlanSourceEnum;

  @Prop({ type: Array, default: [] })
  factors?: any[];

  @Prop({ type: Number, default: null })
  actualProducedQty?: number | null;
}

const ProductionPlanItemSchema = SchemaFactory.createForClass(ProductionPlanItem);

@Schema({ timestamps: true, suppressReservedKeysWarning: true })
export class DailyProductionPlan {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  date!: string; // YYYY-MM-DD

  @Prop({ type: Number, required: true })
  totalRecommendedQty!: number;

  @Prop({ type: [ProductionPlanItemSchema], default: [] })
  items!: ProductionPlanItem[];

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;
}

const DailyProductionPlanSchema = SchemaFactory.createForClass(DailyProductionPlan);

DailyProductionPlanSchema.index({ restaurantId: 1, date: 1 }, { unique: true });
DailyProductionPlanSchema.index({ restaurantId: 1, createdAt: -1 });

export const DailyProductionPlanModel = MongooseModule.forFeature([
  { name: DailyProductionPlan.name, schema: DailyProductionPlanSchema },
]);

export type DailyProductionPlanType = HydratedDocument<DailyProductionPlan> & Document;
