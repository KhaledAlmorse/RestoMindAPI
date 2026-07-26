import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { CsvParsingService } from './services/csv-parsing.service';
import { AiIngestService } from './services/ai-ingest.service';
import {
  CategoryModel,
  ImportJobModel,
  IngredientModel,
  InventoryBatchModel,
  ProductModel,
  RecipeModel,
  RestaurantModel,
  SalesTransactionModel,
  StockTransactionModel,
  UserModel,
} from 'src/DB/Models';
import {
  CategoryRepository,
  ImportJobRepository,
  IngredientRepository,
  InventoryBatchRepository,
  ProductRepository,
  RecipeRepository,
  RestaurantRepository,
  SalesTransactionRepository,
  StockTransactionRepository,
  UserRepository,
} from 'src/DB/Repositories';

@Module({
  imports: [
    ImportJobModel,
    SalesTransactionModel,
    ProductModel,
    RecipeModel,
    IngredientModel,
    InventoryBatchModel,
    StockTransactionModel,
    RestaurantModel,
    UserModel,
    CategoryModel,
  ],
  controllers: [ImportsController],
  providers: [
    ImportsService,
    CsvParsingService,
    AiIngestService,
    ImportJobRepository,
    SalesTransactionRepository,
    ProductRepository,
    RecipeRepository,
    IngredientRepository,
    InventoryBatchRepository,
    StockTransactionRepository,
    RestaurantRepository,
    UserRepository,
    CategoryRepository,
  ],
  exports: [ImportsService, CsvParsingService, AiIngestService],
})
export class ImportsModule {}
