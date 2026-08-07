import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { NotificationType } from 'src/notification/enums/notification-type.enum';

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ['admin', 'manager', 'customer', 'staff'] })
  role!: string;

  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: false, index: true, default: null })
  restaurantId?: Types.ObjectId | null;

  @Prop({ type: String, required: true, enum: NotificationType, index: true })
  type!: NotificationType;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, required: true })
  message!: string;

  @Prop({ type: Types.ObjectId, required: false, default: null })
  relatedEntityId?: Types.ObjectId | null;

  @Prop({ type: String, required: false, default: null })
  relatedEntityType?: string | null;

  @Prop({ type: Boolean, default: false, index: true })
  isRead!: boolean;

  @Prop({ type: Date, required: false, default: null })
  readAt?: Date | null;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Compound indexes for optimal query performance
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, type: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, readAt: -1 });
NotificationSchema.index({ createdAt: 1 });

export const NotificationModel = MongooseModule.forFeature([
  { name: Notification.name, schema: NotificationSchema },
]);

export type NotificationDocument = HydratedDocument<Notification> & Document;
