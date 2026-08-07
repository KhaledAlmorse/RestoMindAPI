import { Injectable, OnModuleInit } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Notification, NotificationDocument } from '../Models/notification.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class NotificationRepository
  extends BaseService<NotificationDocument>
  implements OnModuleInit
{
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {
    super(notificationModel);
  }

  async onModuleInit() {
    try {
      await this.notificationModel.syncIndexes();
    } catch {
      // Ignore sync index error if collection doesn't exist yet
    }
  }

  async deleteExpiredNotifications(retentionDays: number): Promise<number> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - retentionDays);
    const result = await this.notificationModel.deleteMany({
      createdAt: { $lt: thresholdDate },
    });
    return result.deletedCount || 0;
  }
}

