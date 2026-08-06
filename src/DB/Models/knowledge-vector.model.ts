import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class KnowledgeVector {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true, index: true })
  restaurantId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: ['product', 'recipe', 'offer', 'waste_report', 'recommendation', 'weekly_snapshot'],
    index: true,
  })
  entityType!: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  entityId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  textContent!: string;

  @Prop({ type: [Number], required: true })
  embedding!: number[];

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, any>;

  @Prop({ type: Boolean, default: false, index: true })
  isDeleted!: boolean;
}

const KnowledgeVectorSchema = SchemaFactory.createForClass(KnowledgeVector);

KnowledgeVectorSchema.index({ restaurantId: 1, entityType: 1, entityId: 1 }, { unique: true });
KnowledgeVectorSchema.index({ restaurantId: 1, isDeleted: 1 });

export const KnowledgeVectorModel = MongooseModule.forFeature([
  { name: KnowledgeVector.name, schema: KnowledgeVectorSchema },
]);

export type KnowledgeVectorType = HydratedDocument<KnowledgeVector> & Document;
