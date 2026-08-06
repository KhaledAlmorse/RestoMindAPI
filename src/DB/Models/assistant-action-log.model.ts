import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class AssistantActionLog {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true, index: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  sessionId!: string;

  @Prop({ type: String, required: true })
  toolName!: string;

  @Prop({ type: Object, required: true })
  arguments!: Record<string, any>;

  @Prop({
    type: String,
    enum: ['SUCCESS', 'FAILED', 'REJECTED_BY_USER', 'PENDING_APPROVAL'],
    required: true,
  })
  executionStatus!: string;

  @Prop({ type: Number, default: 0 })
  durationMs!: number;

  @Prop({ type: String, required: true })
  modelUsed!: string; // e.g. "anthropic.claude-sonnet-4-6"

  @Prop({ type: Object, default: null })
  executionResult?: Record<string, any>;

  @Prop({ type: String, default: null })
  errorMessage?: string;
}

const AssistantActionLogSchema = SchemaFactory.createForClass(AssistantActionLog);

AssistantActionLogSchema.index({ restaurantId: 1, createdAt: -1 });
AssistantActionLogSchema.index({ userId: 1, sessionId: 1 });

export const AssistantActionLogModel = MongooseModule.forFeature([
  { name: AssistantActionLog.name, schema: AssistantActionLogSchema },
]);

export type AssistantActionLogType = HydratedDocument<AssistantActionLog> & Document;
