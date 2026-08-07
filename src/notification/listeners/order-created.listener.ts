import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';
import { NotificationType } from '../enums/notification-type.enum';

export interface OrderCreatedEventPayload {
  restaurantId: string;
  orderGroupId: string;
  customerName: string;
  totalAmount: number;
}

@Injectable()
export class OrderCreatedListener {
  private readonly logger = new Logger(OrderCreatedListener.name);

  constructor(private readonly notificationService: NotificationService) {}

  @OnEvent('order.created')
  async handleOrderCreatedEvent(payload: OrderCreatedEventPayload) {
    try {
      const shortId = payload.orderGroupId
        ? payload.orderGroupId.slice(-6)
        : '';
      const title = 'New Order Received';
      const message = `Order #${shortId} has been placed by ${payload.customerName || 'a customer'}. Total: ${payload.totalAmount || 0} EGP.`;

      await this.notificationService.createForManager(
        payload.restaurantId,
        NotificationType.NEW_ORDER,
        title,
        message,
        payload.orderGroupId,
        'OrderGroup',
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to handle order.created notification for restaurant ${payload?.restaurantId}: ${err?.message}`,
      );
    }
  }
}
