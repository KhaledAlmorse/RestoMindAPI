import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class AssistantChatHistory {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true, index: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  sessionId!: string;

  @Prop({
    type: [
      {
        role: { type: String, enum: ['user', 'assistant', 'system', 'tool'], required: true },
        content: { type: String, required: true },
        toolCalls: { type: Array, default: [] },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  messages!: Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    toolCalls?: any[];
    timestamp?: Date;
  }>;
}

const AssistantChatHistorySchema = SchemaFactory.createForClass(AssistantChatHistory);

AssistantChatHistorySchema.index({ restaurantId: 1, userId: 1, sessionId: 1 }, { unique: true });
AssistantChatHistorySchema.index({ restaurantId: 1, updatedAt: -1 });

export const AssistantChatHistoryModel = MongooseModule.forFeature([
  { name: AssistantChatHistory.name, schema: AssistantChatHistorySchema },
]);

export type AssistantChatHistoryType = HydratedDocument<AssistantChatHistory> & Document;
