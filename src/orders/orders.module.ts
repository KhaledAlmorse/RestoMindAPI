import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import {
  OrderRepository,
  CartRepository,
  ProductRepository,
} from 'src/DB/Repositories';
import { OrderModel, CartModel, ProductModel } from 'src/DB/Models';

@Module({
  imports: [OrderModel, CartModel, ProductModel],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderRepository,
    CartRepository,
    ProductRepository,
  ],
  exports: [OrdersService, OrderRepository],
})
export class OrdersModule {}
