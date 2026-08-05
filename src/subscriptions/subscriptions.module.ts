import { Module } from '@nestjs/common';
import {
  PaymentModel,
  ProductModel,
  RestaurantModel,
  UserModel,
} from 'src/DB/Models';
import {
  PaymentRepository,
  ProductRepository,
  RestaurantRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { SubscriptionRemindersService } from './subscription-reminders.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

/**
 * PaymentsModule is @Global and registered once in app.module.ts, so
 * PaymentsService is injectable here without importing it. SubscriptionsService
 * registers itself as the 'subscription' fulfiller in onModuleInit, so
 * PaymentsModule never needs to know this module exists — no forwardRef, no
 * circular graph.
 */
@Module({
  imports: [RestaurantModel, ProductModel, UserModel, PaymentModel],
  controllers: [SubscriptionsController],
  providers: [
    RestaurantRepository,
    ProductRepository,
    UserRepository,
    PaymentRepository,
    SubscriptionsService,
    SubscriptionRemindersService,
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
