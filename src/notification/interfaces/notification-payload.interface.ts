import { NotificationType } from '../enums/notification-type.enum';

export interface NotificationPayload {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityId?: string;
  relatedEntityType?: string;
  isRead: boolean;
  createdAt: string;
}
