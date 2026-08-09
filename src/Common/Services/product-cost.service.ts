import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  RecipeRepository,
  InventoryBatchRepository,
} from 'src/DB/Repositories';

/**
 * Real per-unit production cost for a Product, so the AI service can be told an
 * actual `unitCost` instead of never receiving one at all.
 *
 * There is no `unitCost`/`costPerUnit` field on Product or Ingredient — the only real
 * cost data in the system is `InventoryBatch.unitCost`, what was actually paid per
 * batch received. So a product's cost has to be derived: its Recipe (BOM) times each
 * ingredient's most recent batch cost. This is the same recipe-conversion formula
 * `SupplierAutoDraftService` already uses in the opposite direction (ingredient
 * demand from predicted orders) — `qty = quantityPerPortion / effectiveYield` — so a
 * product's unit cost is that same conversion, summed over its ingredients and priced
 * at their latest batch cost.
 */
@Injectable()
export class ProductCostService {
  constructor(
    private readonly recipeRepository: RecipeRepository,
    private readonly inventoryBatchRepository: InventoryBatchRepository,
  ) {}

  /**
   * `null`, not 0, when the product has no recipe or none of its ingredients have
   * ever been received into stock. Sending 0 to the AI service reads as "free to
   * produce" and silently maxes out the profit-optimal production quantity it
   * computes from unitCost — an unknown cost must stay unknown, not become a lie.
   */
  async getUnitCost(
    restaurantId: Types.ObjectId,
    productId: Types.ObjectId,
  ): Promise<number | null> {
    const recipe = await this.recipeRepository.findOne({
      filters: { productId, isDeleted: false },
    });
    if (!recipe?.ingredients?.length) return null;

    let totalCost = 0;
    let pricedIngredients = 0;

    for (const recIng of recipe.ingredients) {
      // Mirrors SupplierAutoDraftService's effectiveYield handling: yieldPercentage
      // is stored as 0-100 (e.g. 80 for 80%), but tolerate an already-fractional
      // value too rather than silently dividing by 100 twice.
      const effectiveYield =
        recIng.yieldPercentage && recIng.yieldPercentage > 0
          ? recIng.yieldPercentage > 1
            ? recIng.yieldPercentage / 100
            : recIng.yieldPercentage
          : 1.0;

      const batches = await this.inventoryBatchRepository.findMany({
        filters: {
          restaurantId,
          ingredientId: recIng.ingredientId,
          isDeleted: false,
        },
        sort: 'createdAt',
        order: 'desc',
      });
      const latestBatch = batches?.[0];
      if (!latestBatch) continue; // never purchased -- don't invent a cost for it

      pricedIngredients += 1;
      totalCost +=
        ((latestBatch.unitCost || 0) * recIng.quantityPerPortion) /
        effectiveYield;
    }

    // Some ingredients unpriced (never received) means this understates the true
    // cost -- still a real, useful number, just not a guarantee every ingredient
    // was counted. Zero priced ingredients means we know nothing at all: null.
    return pricedIngredients > 0 ? Math.round(totalCost * 100) / 100 : null;
  }

  /**
   * Batch form for building an ingest payload: one cost per productId, skipping
   * products with no priceable recipe rather than one query per product at the
   * call site.
   */
  async getUnitCosts(
    restaurantId: Types.ObjectId,
    productIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (const productId of productIds) {
      const cost = await this.getUnitCost(restaurantId, productId);
      if (cost !== null) result.set(productId.toString(), cost);
    }
    return result;
  }
}
