import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController, OrderGroupsController } from './orders.controller';
import {
  OrderRepository,
  OrderGroupRepository,
  CartRepository,
  ProductRepository,
  OfferRepository,
  SalesTransactionRepository,
} from 'src/DB/Repositories';
import {
  OrderModel,
  OrderGroupModel,
  CartModel,
  ProductModel,
  OfferModel,
  SalesTransactionModel,
} from 'src/DB/Models';
import { RestaurantModule } from 'src/restaurant/restaurant.module';

@Module({
  imports: [
    OrderModel,
    OrderGroupModel,
    CartModel,
    ProductModel,
    OfferModel,
    SalesTransactionModel,
    RestaurantModule,
  ],
  controllers: [OrdersController, OrderGroupsController],
  providers: [
    OrdersService,
    OrderRepository,
    OrderGroupRepository,
    CartRepository,
    ProductRepository,
    OfferRepository,
    SalesTransactionRepository,
  ],
  exports: [OrdersService, OrderRepository, OrderGroupRepository],
})
export class OrdersModule {}
