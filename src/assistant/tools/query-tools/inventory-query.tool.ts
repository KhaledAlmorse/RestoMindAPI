import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ToolRegistryService, ToolContext } from '../tool-registry.service';
import { InventoryBatchRepository, IngredientRepository } from 'src/DB/Repositories';

const GetInventoryStatusSchema = z.object({
  filter: z.enum(['expiring', 'low_stock', 'all']).default('all'),
  daysHorizon: z.number().default(7),
});

@Injectable()
export class InventoryQueryTool implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly batchRepo: InventoryBatchRepository,
    private readonly ingredientRepo: IngredientRepository,
  ) {}

  onModuleInit() {
    this.toolRegistry.registerTool({
      name: 'getInventoryStatus',
      description: 'Fetches live stock levels, expiring ingredient batches, and minimum safety stock deficits.',
      schema: GetInventoryStatusSchema,
      requiresApproval: false,
      handler: (params, context) => this.getInventoryStatus(params, context),
    });
  }

  async getInventoryStatus(params: z.infer<typeof GetInventoryStatusSchema>, context: ToolContext) {
    const { filter, daysHorizon } = params;
    const { restaurantId } = context;

    const horizonDate = new Date();
    horizonDate.setDate(horizonDate.getDate() + daysHorizon);

    if (filter === 'expiring') {
      const expiringBatches = (await this.batchRepo.findMany({
        filters: {
          restaurantId,
          isDeleted: false,
          quantityRemaining: { $gt: 0 },
          expiryDate: { $lte: horizonDate },
        } as any,
      })) || [];

      return {
        filter: 'expiring',
        count: expiringBatches.length,
        batches: expiringBatches.map((b) => ({
          batchNumber: b.batchNumber,
          ingredientId: b.ingredientId,
          quantityRemaining: b.quantityRemaining,
          expiryDate: b.expiryDate,
          unitCost: b.unitCost,
        })),
      };
    }

    const ingredients = (await this.ingredientRepo.findMany({ filters: { restaurantId, isDeleted: false } as any })) || [];
    const batches = (await this.batchRepo.findMany({ filters: { restaurantId, isDeleted: false, quantityRemaining: { $gt: 0 } } as any })) || [];

    const stockSummary = ingredients.map((ing) => {
      const ingBatches = batches.filter((b) => b.ingredientId.toString() === (ing._id as any).toString());
      const totalQuantity = ingBatches.reduce((sum, b) => sum + b.quantityRemaining, 0);
      const isLowStock = totalQuantity <= ing.minimumStock;

      return {
        ingredientId: ing._id,
        name: ing.name,
        unit: ing.unit,
        totalQuantity,
        minimumStock: ing.minimumStock,
        safetyStock: ing.safetyStock,
        isLowStock,
        activeBatchesCount: ingBatches.length,
      };
    });

    const result = filter === 'low_stock' ? stockSummary.filter((s) => s.isLowStock) : stockSummary;

    return {
      filter,
      totalIngredientsCount: result.length,
      items: result,
    };
  }
}
