import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { ConfidenceLevelEnum, PredictionSourceEnum } from 'src/Common/Types';

@Schema({ _id: false })
export class DailyBreakdownItem {
  @Prop({ type: String, required: true })
  date!: string;

  @Prop({ type: Number, required: true, default: 0 })
  predictedQuantity!: number;
}

const DailyBreakdownItemSchema = SchemaFactory.createForClass(DailyBreakdownItem);

@Schema({ timestamps: true, suppressReservedKeysWarning: true })
export class Prediction {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  modelVersionId!: string;

  @Prop({ type: String, required: true })
  targetWeek!: string; // YYYY-MM-DD

  @Prop({ type: Number, required: true })
  predictedOrders!: number;

  @Prop({
    type: String,
    enum: Object.values(ConfidenceLevelEnum),
    default: ConfidenceLevelEnum.MEDIUM,
  })
  confidence!: ConfidenceLevelEnum;

  @Prop({
    type: String,
    enum: Object.values(PredictionSourceEnum),
    required: true,
  })
  source!: PredictionSourceEnum;

  @Prop({ type: Object, default: {} })
  featuresUsed?: Record<string, any>;

  @Prop({ type: Array, default: [] })
  factors?: any[];

  @Prop({ type: [DailyBreakdownItemSchema], default: [] })
  dailyBreakdown!: DailyBreakdownItem[];

  @Prop({ type: Number, default: null })
  actualOrders?: number | null;

  @Prop({ type: Number, default: null })
  errorAbs?: number | null;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;
}

const PredictionSchema = SchemaFactory.createForClass(Prediction);

PredictionSchema.index({ restaurantId: 1, productId: 1, targetWeek: 1 }, { unique: true });
PredictionSchema.index({ restaurantId: 1, targetWeek: 1 });
PredictionSchema.index({ restaurantId: 1, productId: 1 });

export const PredictionModel = MongooseModule.forFeature([
  { name: Prediction.name, schema: PredictionSchema },
]);

export type PredictionType = HydratedDocument<Prediction> & Document;
