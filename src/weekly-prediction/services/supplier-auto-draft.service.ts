import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  IngredientRepository,
  InventoryBatchRepository,
  PurchaseOrderRepository,
  RecipeRepository,
  SupplierRepository,
} from 'src/DB/Repositories';
import {
  IngredientUnitEnum,
  PurchaseOrderStatusEnum,
  PurchaseOrderSourceEnum,
} from 'src/Common/Types';
import { PredictionRepository } from 'src/DB/Repositories/prediction.repository';

export interface UnassignedShortfall {
  ingredientId: string;
  ingredientName: string;
  ingredientCode: string;
  shortfall: number;
  unit: IngredientUnitEnum;
}

@Injectable()
export class SupplierAutoDraftService {
  private readonly logger = new Logger(SupplierAutoDraftService.name);

  constructor(
    private readonly predictionRepository: PredictionRepository,
    private readonly recipeRepository: RecipeRepository,
    private readonly ingredientRepository: IngredientRepository,
    private readonly inventoryBatchRepository: InventoryBatchRepository,
    private readonly purchaseOrderRepository: PurchaseOrderRepository,
    private readonly supplierRepository: SupplierRepository,
  ) {}

  /**
   * Main workflow for generating auto-draft purchase orders from predictions for targetWeek
   */
  async generateAutoDrafts(
    restaurantId: Types.ObjectId,
    targetWeek: string,
    createdByUserId: Types.ObjectId,
  ) {
    const targetWeekStart = new Date(`${targetWeek}T00:00:00.000Z`);

    // 1. Get all stored predictions for targetWeek
    const predictions = await this.predictionRepository.findMany({
      filters: {
        restaurantId,
        targetWeek,
        isDeleted: false,
      },
    });

    if (!predictions || predictions.length === 0) {
      return {
        draftPurchaseOrders: [],
        unassignedShortfalls: [],
        reusedExistingDrafts: 0,
        message: 'No predictions found for the specified target week.',
      };
    }

    // 2. Perform MANDATORY recipe conversion for all predicted products
    // Map<ingredientIdString, requiredQty>
    const ingredientDemandMap = new Map<string, number>();

    for (const pred of predictions) {
      if (pred.predictedOrders <= 0) continue;

      const recipe = await this.recipeRepository.findOne({
        filters: {
          productId: pred.productId,
          isDeleted: false,
        },
      });

      if (!recipe || !recipe.ingredients || recipe.ingredients.length === 0) {
        continue;
      }

      for (const recIng of recipe.ingredients) {
        const ingIdStr = recIng.ingredientId.toString();

        // MANDATORY recipe conversion formula:
        // requiredQty = predictedOrders * quantityPerPortion / yieldPercentage
        // Note: yieldPercentage is stored as 0-100 (e.g. 100 for 100%, 80 for 80%)
        const effectiveYield =
          recIng.yieldPercentage && recIng.yieldPercentage > 0
            ? recIng.yieldPercentage > 1
              ? recIng.yieldPercentage / 100
              : recIng.yieldPercentage
            : 1.0;

        const qtyNeeded =
          (pred.predictedOrders * recIng.quantityPerPortion) / effectiveYield;

        const currentTotal = ingredientDemandMap.get(ingIdStr) || 0;
        ingredientDemandMap.set(ingIdStr, currentTotal + qtyNeeded);
      }
    }

    if (ingredientDemandMap.size === 0) {
      return {
        draftPurchaseOrders: [],
        unassignedShortfalls: [],
        reusedExistingDrafts: 0,
        message: 'No ingredient demand derived from recipes.',
      };
    }

    // 3. Compare required ingredient quantities against usable available stock
    const unassignedShortfalls: UnassignedShortfall[] = [];
    const supplierItemsMap = new Map<
      string,
      Array<{
        ingredientId: Types.ObjectId;
        quantity: number;
        unit: IngredientUnitEnum;
        unitCost: number;
      }>
    >();

    // Fetch sent POs ONCE. This used to run inside the per-ingredient loop,
    // scanning the whole collection N times and filtering items in JS.
    const sentPOs =
      (await this.purchaseOrderRepository.findMany({
        filters: {
          restaurantId,
          status: PurchaseOrderStatusEnum.SENT,
          isDeleted: false,
          expectedDeliveryDate: { $lte: targetWeekStart },
        },
      })) || [];

    const incomingByIngredient = new Map<string, number>();
    for (const po of sentPOs) {
      for (const item of po.items || []) {
        const key = item.ingredientId.toString();
        incomingByIngredient.set(
          key,
          (incomingByIngredient.get(key) || 0) + (item.quantity || 0),
        );
      }
    }

    for (const [ingIdStr, requiredQty] of ingredientDemandMap.entries()) {
      const ingredientId = new Types.ObjectId(ingIdStr);
      const ingredient = await this.ingredientRepository.findOne({
        filters: { _id: ingredientId, isDeleted: false },
      });

      if (!ingredient) continue;

      // Phase 3 stock calculation:
      // usableAvailableStock = SUM(batches.quantityRemaining WHERE expiryDate > targetWeekStart)
      //                      + SUM(sent purchase_orders.items.quantity WHERE expectedDeliveryDate <= targetWeekStart)
      const batches = await this.inventoryBatchRepository.findMany({
        filters: {
          restaurantId,
          ingredientId,
          isDeleted: false,
          expiryDate: { $gt: targetWeekStart },
        },
        // `batches[0]` supplies unitCost below; without a sort that was
        // whichever document Mongo happened to return first.
        // Note: InventoryBatchRepository.findMany takes `sort` as a field
        // name string plus a separate `order`, not an object.
        sort: 'createdAt',
        order: 'desc',
      });

      const currentBatchStock = batches.reduce(
        (sum, b) => sum + (b.quantityRemaining || 0),
        0,
      );

      const incomingPOStock = incomingByIngredient.get(ingIdStr) || 0;
      const usableAvailableStock = currentBatchStock + incomingPOStock;
      const shortfall = requiredQty - usableAvailableStock;

      if (shortfall <= 0) {
        // Stock is sufficient, no purchase order needed
        continue;
      }

      // Ingredient shortfall exists! Find supplier for ingredient.
      let supplierId: Types.ObjectId | null = ingredient.supplierId
        ? new Types.ObjectId(ingredient.supplierId.toString())
        : null;

      if (!supplierId) {
        // Check if there is an existing PO for this ingredient
        const existingPO = await this.purchaseOrderRepository.findOne({
          filters: {
            restaurantId,
            'items.ingredientId': ingredientId,
            isDeleted: false,
          },
        });
        if (existingPO) {
          supplierId = existingPO.supplierId;
        }
      }

      if (!supplierId) {
        // Check if restaurant has exactly 1 supplier
        const allSuppliers = await this.supplierRepository.findMany({
          filters: { restaurantId, isDeleted: false },
        });
        if (allSuppliers && allSuppliers.length === 1) {
          supplierId = allSuppliers[0]._id;
        }
      }

      // CRITICAL REQUIREMENT 5: Missing supplier handling
      if (!supplierId) {
        this.logger.warn(
          `[MISSING SUPPLIER] Ingredient ${ingredient.name} (${ingredient.ingredientCode}) has shortfall of ${shortfall} ${ingredient.unit} but no supplier assigned. Skipping PO creation.`,
        );
        unassignedShortfalls.push({
          ingredientId: ingIdStr,
          ingredientName: ingredient.name,
          ingredientCode: ingredient.ingredientCode,
          shortfall: Math.round(shortfall * 100) / 100,
          unit: ingredient.unit,
        });
        continue; // Continue processing remaining ingredients
      }

      // Resolve unitCost from latest batch or default 0
      const latestBatch = batches.length > 0 ? batches[0] : null;
      const unitCost = latestBatch ? latestBatch.unitCost : 0;

      const roundedShortfall = Math.round(shortfall * 100) / 100;
      const supplierKey = supplierId.toString();
      const itemsList = supplierItemsMap.get(supplierKey) || [];

      itemsList.push({
        ingredientId,
        quantity: roundedShortfall,
        unit: ingredient.unit,
        unitCost,
      });

      supplierItemsMap.set(supplierKey, itemsList);
    }

    // 4. Upsert one draft PO per supplier for this target week.
    const createdPOs: any[] = [];
    let reusedExistingDrafts = 0;

    for (const [supIdStr, items] of supplierItemsMap.entries()) {
      const supplierId = new Types.ObjectId(supIdStr);

      // Without this lookup every recalculation produced a fresh duplicate
      // draft, while predictions themselves upsert.
      const existingDraft = await this.purchaseOrderRepository.findOne({
        filters: {
          restaurantId,
          supplierId,
          status: PurchaseOrderStatusEnum.DRAFT,
          source: PurchaseOrderSourceEnum.AI_FORECAST,
          expectedDeliveryDate: targetWeekStart,
          isDeleted: false,
        },
      });

      if (existingDraft) {
        const updated = await this.purchaseOrderRepository.update({
          filters: { _id: existingDraft._id },
          body: { items, createdBy: createdByUserId } as any,
        });
        reusedExistingDrafts++;
        createdPOs.push(updated ?? existingDraft);
        continue;
      }

      const po = await this.purchaseOrderRepository.create({
        restaurantId,
        supplierId,
        items,
        status: PurchaseOrderStatusEnum.DRAFT,
        source: PurchaseOrderSourceEnum.AI_FORECAST,
        expectedDeliveryDate: targetWeekStart,
        createdBy: createdByUserId,
      } as any);

      createdPOs.push(po);
    }

    return {
      draftPurchaseOrders: createdPOs,
      unassignedShortfalls,
      reusedExistingDrafts,
    };
  }
}
