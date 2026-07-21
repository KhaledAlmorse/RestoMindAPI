import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController, OrderGroupsController } from './orders.controller';
import {
  OrderRepository,
  OrderGroupRepository,
  CartRepository,
  ProductRepository,
  OfferRepository,
} from 'src/DB/Repositories';
import {
  OrderModel,
  OrderGroupModel,
  CartModel,
  ProductModel,
  OfferModel,
} from 'src/DB/Models';
import { RestaurantModule } from 'src/restaurant/restaurant.module';

@Module({
  imports: [
    OrderModel,
    OrderGroupModel,
    CartModel,
    ProductModel,
    OfferModel,
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
  ],
  exports: [OrdersService, OrderRepository, OrderGroupRepository],
})
export class OrdersModule {}
