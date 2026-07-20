import { Module } from '@nestjs/common';
import { IngredientsService } from './ingredients.service';
import { IngredientsController } from './ingredients.controller';
import {
  IngredientRepository,
  RestaurantRepository,
  UserRepository,
} from 'src/DB/Repositories';
import {
  IngredientModel,
  RestaurantModel,
  UserModel,
} from 'src/DB/Models';

@Module({
  imports: [IngredientModel, RestaurantModel, UserModel],
  controllers: [IngredientsController],
  providers: [
    IngredientsService,
    IngredientRepository,
    RestaurantRepository,
    UserRepository,
  ],
  exports: [IngredientsService, IngredientRepository],
})
export class IngredientsModule {}
