import { Module } from '@nestjs/common';
import { IngredientsService } from './ingredients.service';
import { IngredientsController } from './ingredients.controller';
import {
  IngredientRepository,
  RecipeRepository,
  RestaurantRepository,
  UserRepository,
} from 'src/DB/Repositories';
import {
  IngredientModel,
  RecipeModel,
  RestaurantModel,
  UserModel,
} from 'src/DB/Models';

@Module({
  imports: [IngredientModel, RecipeModel, RestaurantModel, UserModel],
  controllers: [IngredientsController],
  providers: [
    IngredientsService,
    IngredientRepository,
    RecipeRepository,
    RestaurantRepository,
    UserRepository,
  ],
  exports: [IngredientsService, IngredientRepository],
})
export class IngredientsModule {}
