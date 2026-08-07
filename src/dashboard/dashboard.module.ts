import { Module } from '@nestjs/common';
import {
  OfferModel,
  OrderGroupModel,
  OrderModel,
  PaymentModel,
  PayoutModel,
  RefundModel,
  RestaurantModel,
  UserModel,
} from 'src/DB/Models';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    OrderGroupModel,
    OrderModel,
    OfferModel,
    RestaurantModel,
    UserModel,
    PaymentModel,
    RefundModel,
    PayoutModel,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
