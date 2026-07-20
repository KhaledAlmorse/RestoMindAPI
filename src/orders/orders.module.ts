import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import {
  OrderRepository,
  OrderGroupRepository,
  CartRepository,
  ProductRepository,
} from 'src/DB/Repositories';
import {
  OrderModel,
  OrderGroupModel,
  CartModel,
  ProductModel,
} from 'src/DB/Models';
import { RestaurantModule } from 'src/restaurant/restaurant.module';

@Module({
  imports: [
    OrderModel,
    OrderGroupModel,
    CartModel,
    ProductModel,
    RestaurantModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderRepository,
    OrderGroupRepository,
    CartRepository,
    ProductRepository,
  ],
  exports: [OrdersService, OrderRepository, OrderGroupRepository],
})
export class OrdersModule {}
