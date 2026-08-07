import { Module } from '@nestjs/common';
import {
  MerchantAdjustmentModel,
  OrderModel,
  PaymentModel,
  PayoutModel,
  RefundModel,
  RestaurantModel,
} from 'src/DB/Models';
import {
  MerchantAdjustmentRepository,
  OrderRepository,
  PaymentRepository,
  PayoutRepository,
  RefundRepository,
  RestaurantRepository,
} from 'src/DB/Repositories';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [
    OrderModel,
    PaymentModel,
    RefundModel,
    RestaurantModel,
    PayoutModel,
    MerchantAdjustmentModel,
  ],
  controllers: [PayoutsController],
  providers: [
    OrderRepository,
    PaymentRepository,
    RefundRepository,
    RestaurantRepository,
    PayoutRepository,
    MerchantAdjustmentRepository,
    PayoutsService,
  ],
  exports: [PayoutsService],
})
export class PayoutsModule {}
