import { Module } from '@nestjs/common';
import { NotificationModel, RestaurantModel, UserModel } from 'src/DB/Models';
import {
  NotificationRepository,
  RestaurantRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { NotificationController } from './notification.controller';
import { NotificationGateway } from './notification.gateway';
import { NotificationService } from './notification.service';
import { OrderCreatedListener } from './listeners/order-created.listener';
import { PartnershipApplicationCreatedListener } from './listeners/partnership-application-created.listener';

import { NotificationCleanupService } from './services/notification-cleanup.service';

@Module({
  imports: [NotificationModel, RestaurantModel, UserModel],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationRepository,
    RestaurantRepository,
    UserRepository,
    NotificationGateway,
    NotificationCleanupService,
    OrderCreatedListener,
    PartnershipApplicationCreatedListener,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}

