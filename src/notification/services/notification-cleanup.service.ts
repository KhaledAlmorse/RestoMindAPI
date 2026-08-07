import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationRepository } from 'src/DB/Repositories';

@Injectable()
export class NotificationCleanupService {
  private readonly logger = new Logger(NotificationCleanupService.name);

  constructor(
    private readonly notificationRepository: NotificationRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleCronCleanup() {
    const rawDays = process.env.NOTIFICATION_RETENTION_DAYS;
    const retentionDays = rawDays ? parseInt(rawDays, 10) : 90;

    this.logger.log(
      `Notification cleanup started. Retention period: ${retentionDays} days.`,
    );

    try {
      const deletedCount =
        await this.notificationRepository.deleteExpiredNotifications(
          retentionDays,
        );
      this.logger.log(
        `Notification cleanup finished successfully. Deleted ${deletedCount} expired notification(s).`,
      );
    } catch (err: any) {
      this.logger.error(
        `Notification cleanup failure: ${err?.message}`,
        err?.stack,
      );
    }
  }
}
