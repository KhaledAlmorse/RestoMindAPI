import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import {
  IngredientRepository,
  InventoryBatchRepository,
  RestaurantRepository,
  StockTransactionRepository,
  UserRepository,
  WasteEventRepository,
} from 'src/DB/Repositories';
import {
  IngredientModel,
  InventoryBatchModel,
  RestaurantModel,
  StockTransactionModel,
  UserModel,
  WasteEventModel,
} from 'src/DB/Models';

@Module({
  imports: [
    InventoryBatchModel,
    StockTransactionModel,
    WasteEventModel,
    IngredientModel,
    RestaurantModel,
    UserModel,
  ],
  controllers: [InventoryController],
  providers: [
    InventoryService,
    InventoryBatchRepository,
    StockTransactionRepository,
    WasteEventRepository,
    IngredientRepository,
    RestaurantRepository,
    UserRepository,
  ],
  exports: [
    InventoryService,
    InventoryBatchRepository,
    StockTransactionRepository,
    WasteEventRepository,
  ],
})
export class InventoryModule {}
