import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import {
  CartRepository,
  ProductRepository,
  OfferRepository,
  OrderRepository,
} from 'src/DB/Repositories';
import { CartModel, ProductModel, OfferModel, OrderModel } from 'src/DB/Models';

@Module({
  imports: [CartModel, ProductModel, OfferModel, OrderModel],
  controllers: [CartController],
  providers: [
    CartService,
    CartRepository,
    ProductRepository,
    OfferRepository,
    OrderRepository,
  ],
  exports: [CartService, CartRepository],
})
export class CartModule {}
