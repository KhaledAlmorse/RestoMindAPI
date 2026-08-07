import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { RefundsService } from './refunds.service';
import { RefundsController } from './refunds.controller';
import {
  OrderRepository,
  OrderGroupRepository,
  CartRepository,
  ProductRepository,
  OfferRepository,
  SalesTransactionRepository,
  RecipeRepository,
  IngredientRepository,
  InventoryBatchRepository,
  StockTransactionRepository,
} from 'src/DB/Repositories';
import {
  OrderModel,
  OrderGroupModel,
  CartModel,
  ProductModel,
  OfferModel,
  SalesTransactionModel,
  RecipeModel,
  IngredientModel,
  InventoryBatchModel,
  StockTransactionModel,
} from 'src/DB/Models';
import { RestaurantModule } from 'src/restaurant/restaurant.module';
import { OffersModule } from 'src/offers/offers.module';

@Module({
  imports: [
    OrderModel,
    OrderGroupModel,
    CartModel,
    ProductModel,
    OfferModel,
    SalesTransactionModel,
    RecipeModel,
    IngredientModel,
    InventoryBatchModel,
    StockTransactionModel,
    RestaurantModule,
    OffersModule,
  ],
  controllers: [RefundsController, OrdersController],
  providers: [
    OrdersService,
    OrderRepository,
    OrderGroupRepository,
    CartRepository,
    ProductRepository,
    OfferRepository,
    SalesTransactionRepository,
    RecipeRepository,
    IngredientRepository,
    InventoryBatchRepository,
    StockTransactionRepository,
    RefundsService,
  ],
  exports: [OrdersService, OrderRepository, OrderGroupRepository],
})
export class OrdersModule { }
