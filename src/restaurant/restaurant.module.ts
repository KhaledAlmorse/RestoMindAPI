import { Module } from '@nestjs/common';
import { RestaurantService } from './restaurant.service';
import { RestaurantController } from './restaurant.controller';
import {
  RestaurantRepository,
  ProductRepository,
  OfferRepository,
  IngredientRepository,
  RecipeRepository,
} from 'src/DB/Repositories';
import {
  RestaurantModel,
  ProductModel,
  OfferModel,
  IngredientModel,
  RecipeModel,
} from 'src/DB/Models';

@Module({
  imports: [
    RestaurantModel,
    ProductModel,
    OfferModel,
    IngredientModel,
    RecipeModel,
  ],
  controllers: [RestaurantController],
  providers: [
    RestaurantService,
    RestaurantRepository,
    ProductRepository,
    OfferRepository,
    IngredientRepository,
    RecipeRepository,
  ],
  exports: [
    RestaurantService,
    RestaurantRepository,
    ProductRepository,
    OfferRepository,
    IngredientRepository,
    RecipeRepository,
  ],
})
export class RestaurantModule {}
