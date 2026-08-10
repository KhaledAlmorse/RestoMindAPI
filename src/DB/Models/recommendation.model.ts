import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import {
  RecommendationStatusEnum,
  RecommendationTypeEnum,
} from 'src/Common/Types';

@Schema({ timestamps: true })
export class Recommendation {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WasteReport', default: null })
  wasteReportId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(RecommendationTypeEnum),
    required: true,
  })
  type!: RecommendationTypeEnum;

  @Prop({ type: Number, default: null })
  suggestedValue?: number;

  @Prop({ type: Number, default: null })
  suggestedQuantity?: number;

  @Prop({ type: Types.ObjectId, ref: 'Restaurant', default: null })
  targetRestaurantId?: Types.ObjectId;

  @Prop({ type: String, default: null })
  gptExplanation?: string;

  @Prop({
    type: String,
    enum: Object.values(RecommendationStatusEnum),
    default: RecommendationStatusEnum.PENDING,
    required: true,
  })
  status!: RecommendationStatusEnum;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;
}

const RecommendationSchema = SchemaFactory.createForClass(Recommendation);
RecommendationSchema.index({ restaurantId: 1, status: 1 });
RecommendationSchema.index({ productId: 1, status: 1 });

export const RecommendationModel = MongooseModule.forFeature([
  { name: Recommendation.name, schema: RecommendationSchema },
]);

export type RecommendationType = HydratedDocument<Recommendation> & Document;
