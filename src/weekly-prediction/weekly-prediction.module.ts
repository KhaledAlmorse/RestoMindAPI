import { Module } from '@nestjs/common';
import { WeeklyPredictionController } from './weekly-prediction.controller';
import { WeeklyPredictionService } from './weekly-prediction.service';
import { SupplierAutoDraftService } from './services/supplier-auto-draft.service';
import {
  IngredientRepository,
  InventoryBatchRepository,
  OfferRepository,
  PredictionRepository,
  ProductRepository,
  PurchaseOrderRepository,
  RecipeRepository,
  RestaurantRepository,
  SalesTransactionRepository,
  SupplierRepository,
  UserRepository,
} from 'src/DB/Repositories';
import {
  IngredientModel,
  InventoryBatchModel,
  OfferModel,
  PredictionModel,
  ProductModel,
  PurchaseOrderModel,
  RecipeModel,
  RestaurantModel,
  SalesTransactionModel,
  SupplierModel,
  UserModel,
} from 'src/DB/Models';

@Module({
  imports: [
    PredictionModel,
    RecipeModel,
    IngredientModel,
    PurchaseOrderModel,
    InventoryBatchModel,
    OfferModel,
    ProductModel,
    SalesTransactionModel,
    SupplierModel,
    RestaurantModel,
    UserModel,
  ],
  controllers: [WeeklyPredictionController],
  providers: [
    WeeklyPredictionService,
    SupplierAutoDraftService,
    PredictionRepository,
    RecipeRepository,
    IngredientRepository,
    PurchaseOrderRepository,
    InventoryBatchRepository,
    OfferRepository,
    ProductRepository,
    SalesTransactionRepository,
    SupplierRepository,
    RestaurantRepository,
    UserRepository,
  ],
  exports: [
    WeeklyPredictionService,
    SupplierAutoDraftService,
    PredictionRepository,
  ],
})
export class WeeklyPredictionModule {}
