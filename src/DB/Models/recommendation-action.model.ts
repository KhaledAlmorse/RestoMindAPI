import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class RecommendationAction {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true, index: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Recommendation', required: true, index: true })
  recommendationId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['PENDING', 'SELECTED', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED'],
    required: true,
    default: 'PENDING',
  })
  status!: string;

  @Prop({ type: Boolean, default: false })
  selectedByUser!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  actedBy?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  executedAt?: Date;

  @Prop({ type: String, required: true })
  relatedTool!: string;

  @Prop({ type: Object, default: null })
  executionResult?: Record<string, any>;
}

const RecommendationActionSchema = SchemaFactory.createForClass(RecommendationAction);

RecommendationActionSchema.index({ restaurantId: 1, recommendationId: 1 });
RecommendationActionSchema.index({ restaurantId: 1, status: 1 });

export const RecommendationActionModel = MongooseModule.forFeature([
  { name: RecommendationAction.name, schema: RecommendationActionSchema },
]);

export type RecommendationActionType = HydratedDocument<RecommendationAction> & Document;
