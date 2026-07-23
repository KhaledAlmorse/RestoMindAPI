import { Module } from '@nestjs/common';
import {
  OfferModel,
  OrderGroupModel,
  OrderModel,
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
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
