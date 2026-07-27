import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { RiskLevelEnum } from 'src/Common/Types';

@Schema({ timestamps: true })
export class WasteReport {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Prediction', default: null })
  predictionId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ingredient', required: true })
  ingredientId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  expectedConsumption!: number;

  @Prop({ type: Number, required: true })
  usableAvailableStock!: number;

  @Prop({ type: Number, required: true })
  expectedSurplus!: number;

  @Prop({
    type: String,
    enum: Object.values(RiskLevelEnum),
    required: true,
  })
  riskLevel!: RiskLevelEnum;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;
}

const WasteReportSchema = SchemaFactory.createForClass(WasteReport);
WasteReportSchema.index({ restaurantId: 1, createdAt: -1 });
WasteReportSchema.index({ ingredientId: 1 });

export const WasteReportModel = MongooseModule.forFeature([
  { name: WasteReport.name, schema: WasteReportSchema },
]);

export type WasteReportType = HydratedDocument<WasteReport> & Document;
