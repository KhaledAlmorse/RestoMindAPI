import { Module } from '@nestjs/common';

import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

import {
  ProductRepository,
  CategoryRepository,
  OfferRepository,
  RecipeRepository,
  IngredientRepository,
  UserRepository,
} from 'src/DB/Repositories';

import {
  ProductModel,
  CategoryModel,
  OfferModel,
  RecipeModel,
  IngredientModel,
  UserModel,
} from 'src/DB/Models';

import { RestaurantModule } from 'src/restaurant/restaurant.module';
import { OffersModule } from 'src/offers/offers.module';
// No cycle: SubscriptionsModule imports only DB model modules, never this one.
import { SubscriptionsModule } from 'src/subscriptions/subscriptions.module';

@Module({
  imports: [
    ProductModel,
    CategoryModel,
    RestaurantModule,
    OffersModule,
    OfferModel,
    RecipeModel,
    IngredientModel,
    UserModel,
    SubscriptionsModule,
  ],
  controllers: [ProductsController],
  providers: [
    ProductsService,
    ProductRepository,
    CategoryRepository,
    OfferRepository,
    RecipeRepository,
    IngredientRepository,
    UserRepository,
  ],
  exports: [ProductsService, ProductRepository, RecipeRepository],
})
export class ProductsModule {}
