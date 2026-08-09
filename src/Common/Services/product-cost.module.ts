import { Global, Module } from '@nestjs/common';
import { RecipeModel } from 'src/DB/Models/recipe.model';
import { InventoryBatchModel } from 'src/DB/Models/inventory-batch.model';
import { RecipeRepository, InventoryBatchRepository } from 'src/DB/Repositories';
import { ProductCostService } from './product-cost.service';

/**
 * Global so every AI-ingest call site (weekly-prediction, imports, production-planning)
 * can inject `ProductCostService` without each importing the Recipe/InventoryBatch
 * Mongoose feature modules and repositories itself -- same pattern as `AiClientModule`.
 */
@Global()
@Module({
  imports: [RecipeModel, InventoryBatchModel],
  providers: [RecipeRepository, InventoryBatchRepository, ProductCostService],
  exports: [ProductCostService],
})
export class ProductCostModule {}
