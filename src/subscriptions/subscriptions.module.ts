import { Module } from '@nestjs/common';
import {
  PaymentModel,
  ProductModel,
  RestaurantModel,
  SubscriptionPlanModel,
  UserModel,
} from 'src/DB/Models';
import {
  PaymentRepository,
  ProductRepository,
  RestaurantRepository,
  SubscriptionPlanRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { SubscriptionRemindersService } from './subscription-reminders.service';
import { SubscriptionPlansController } from './subscription-plans.controller';
import { SubscriptionPlansService } from './subscription-plans.service';
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
  imports: [
    RestaurantModel,
    ProductModel,
    UserModel,
    PaymentModel,
    SubscriptionPlanModel,
  ],
  controllers: [SubscriptionsController, SubscriptionPlansController],
  providers: [
    RestaurantRepository,
    ProductRepository,
    UserRepository,
    PaymentRepository,
    SubscriptionPlanRepository,
    SubscriptionsService,
    SubscriptionPlansService,
    SubscriptionRemindersService,
  ],
  exports: [SubscriptionsService, SubscriptionPlansService],
})
export class SubscriptionsModule {}
