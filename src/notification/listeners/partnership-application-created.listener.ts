import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';
import { NotificationType } from '../enums/notification-type.enum';

export interface PartnershipApplicationCreatedEventPayload {
  applicationId: string;
  businessName: string;
  ownerFirstName: string;
  ownerLastName: string;
}

@Injectable()
export class PartnershipApplicationCreatedListener {
  private readonly logger = new Logger(
    PartnershipApplicationCreatedListener.name,
  );

  constructor(private readonly notificationService: NotificationService) {}

  @OnEvent('partnership-application.created')
  async handlePartnershipApplicationCreated(
    payload: PartnershipApplicationCreatedEventPayload,
  ) {
    try {
      const title = 'New Partnership Application';
      const ownerFullName =
        `${payload.ownerFirstName || ''} ${payload.ownerLastName || ''}`.trim();
      const message = `New partnership application submitted for "${payload.businessName}" by ${ownerFullName || 'an applicant'}.`;

      await this.notificationService.fanOutToAdmins(
        NotificationType.NEW_PARTNERSHIP_APPLICATION,
        title,
        message,
        payload.applicationId,
        'PartnershipApplication',
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to handle partnership-application.created notification for app ${payload?.applicationId}: ${err?.message}`,
      );
    }
  }
}
