import { Module } from '@nestjs/common';
import {
  CategoryModel,
  IngredientModel,
  InventoryBatchModel,
  OfferModel,
  PredictionModel,
  ProductModel,
  RecipeModel,
  RecommendationModel,
  RestaurantModel,
  SalesTransactionModel,
  UserModel,
  WasteReportModel,
} from 'src/DB/Models';
import {
  CategoryRepository,
  IngredientRepository,
  InventoryBatchRepository,
  OfferRepository,
  PredictionRepository,
  ProductRepository,
  RecipeRepository,
  RecommendationRepository,
  RestaurantRepository,
  SalesTransactionRepository,
  UserRepository,
  WasteReportRepository,
} from 'src/DB/Repositories';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [
    RecommendationModel,
    WasteReportModel,
    ProductModel,
    OfferModel,
    RestaurantModel,
    UserModel,
    CategoryModel,
    SalesTransactionModel,
    InventoryBatchModel,
    IngredientModel,
    RecipeModel,
    PredictionModel,
  ],
  controllers: [RecommendationsController],
  providers: [
    RecommendationsService,
    RecommendationRepository,
    WasteReportRepository,
    ProductRepository,
    OfferRepository,
    RestaurantRepository,
    UserRepository,
    CategoryRepository,
    SalesTransactionRepository,
    InventoryBatchRepository,
    IngredientRepository,
    RecipeRepository,
    PredictionRepository,
  ],
  exports: [RecommendationsService, RecommendationRepository],
})
export class RecommendationsModule {}
