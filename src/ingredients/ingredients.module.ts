import { Module } from '@nestjs/common';
import { IngredientsService } from './ingredients.service';
import { IngredientsController } from './ingredients.controller';
import {
  IngredientRepository,
  RecipeRepository,
  RestaurantRepository,
  SupplierRepository,
  UserRepository,
} from 'src/DB/Repositories';
import {
  IngredientModel,
  RecipeModel,
  RestaurantModel,
  SupplierModel,
  UserModel,
} from 'src/DB/Models';

@Module({
  imports: [
    IngredientModel,
    RecipeModel,
    RestaurantModel,
    SupplierModel,
    UserModel,
  ],
  controllers: [IngredientsController],
  providers: [
    IngredientsService,
    IngredientRepository,
    RecipeRepository,
    RestaurantRepository,
    SupplierRepository,
    UserRepository,
  ],
  exports: [IngredientsService, IngredientRepository],
})
export class IngredientsModule {}
