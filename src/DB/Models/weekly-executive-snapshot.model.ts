import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class WeeklyExecutiveSnapshot {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true, index: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  targetWeek!: string; // YYYY-MM-DD (Sunday)

  @Prop({ type: Number, required: true })
  totalSalesRevenue!: number;

  @Prop({ type: Number, required: true })
  totalWasteCost!: number;

  @Prop({ type: String, required: true })
  topWastedIngredient!: string;

  @Prop({ type: String, required: true })
  topSellingProduct!: string;

  @Prop({ type: Number, required: true })
  aiPredictionAccuracy!: number;

  @Prop({ type: String, required: true })
  narrativeSummary!: string;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;
}

const WeeklyExecutiveSnapshotSchema = SchemaFactory.createForClass(WeeklyExecutiveSnapshot);

WeeklyExecutiveSnapshotSchema.index({ restaurantId: 1, targetWeek: 1 }, { unique: true });
WeeklyExecutiveSnapshotSchema.index({ restaurantId: 1, createdAt: -1 });

export const WeeklyExecutiveSnapshotModel = MongooseModule.forFeature([
  { name: WeeklyExecutiveSnapshot.name, schema: WeeklyExecutiveSnapshotSchema },
]);

export type WeeklyExecutiveSnapshotType = HydratedDocument<WeeklyExecutiveSnapshot> & Document;
