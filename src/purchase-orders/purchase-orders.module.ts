import { Module } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import {
  IngredientRepository,
  InventoryBatchRepository,
  PurchaseOrderRepository,
  RestaurantRepository,
  StockTransactionRepository,
  SupplierRepository,
  UserRepository,
} from 'src/DB/Repositories';
import {
  IngredientModel,
  InventoryBatchModel,
  PurchaseOrderModel,
  RestaurantModel,
  StockTransactionModel,
  SupplierModel,
  UserModel,
} from 'src/DB/Models';

@Module({
  imports: [
    PurchaseOrderModel,
    SupplierModel,
    IngredientModel,
    InventoryBatchModel,
    StockTransactionModel,
    RestaurantModel,
    UserModel,
  ],
  controllers: [PurchaseOrdersController],
  providers: [
    PurchaseOrdersService,
    PurchaseOrderRepository,
    SupplierRepository,
    IngredientRepository,
    InventoryBatchRepository,
    StockTransactionRepository,
    RestaurantRepository,
    UserRepository,
  ],
  exports: [PurchaseOrdersService, PurchaseOrderRepository],
})
export class PurchaseOrdersModule {}
