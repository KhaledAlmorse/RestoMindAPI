import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isValidObjectId, Types } from 'mongoose';
import {
  OfferSourceEnum,
  OfferStatusEnum,
  RecommendationStatusEnum,
  RecommendationTypeEnum,
  RiskLevelEnum,
} from 'src/Common/Types';
import {
  CategoryRepository,
  DailyProductionPlanRepository,
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
import { ApproveRecommendationDto } from './dto/approve-recommendation.dto';
import { EditRecommendationDto } from './dto/edit-recommendation.dto';
import { QueryRecommendationDto } from './dto/query-recommendation.dto';
import { ValidatePlanDto } from './dto/validate-plan.dto';

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly recommendationRepository: RecommendationRepository,
    private readonly wasteReportRepository: WasteReportRepository,
    private readonly productRepository: ProductRepository,
    private readonly offerRepository: OfferRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly userRepository: UserRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly salesTransactionRepository: SalesTransactionRepository,
    private readonly inventoryBatchRepository: InventoryBatchRepository,
    private readonly ingredientRepository: IngredientRepository,
    private readonly recipeRepository: RecipeRepository,
    private readonly predictionRepository: PredictionRepository,
    private readonly dailyProductionPlanRepository: DailyProductionPlanRepository,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  private async getManagerRestaurantId(
    userId: string,
  ): Promise<Types.ObjectId> {
    this.validateObjectId(userId);
    const user = await this.userRepository.findOne({
      filters: { _id: new Types.ObjectId(userId), isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.restaurantId) {
      return new Types.ObjectId(user.restaurantId.toString());
    }

    const restaurant = await this.restaurantRepository.findOne({
      filters: { ownerUserId: new Types.ObjectId(userId), isDeleted: false },
    });

    if (!restaurant) {
      throw new ForbiddenException(
        'You are not assigned to a restaurant or do not own one',
      );
    }

    return restaurant._id;
  }

  async findAll(userId: string, query: QueryRecommendationDto) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const filters: Record<string, any> = {
      restaurantId,
      isDeleted: false,
    };

    if (query.status) {
      filters.status = query.status;
    }

    if (query.type) {
      filters.type = query.type;
    }

    if (query.productId) {
      this.validateObjectId(query.productId);
      filters.productId = new Types.ObjectId(query.productId);
    }

    return this.recommendationRepository.findManyPaginated({
      filters,
      skip,
      limit,
      sort: 'createdAt',
      order: 'desc',
      populationArray: [
        {
          path: 'productId',
          select: 'title category price freshnessWindow image',
        },
        { path: 'wasteReportId' },
        { path: 'reviewedBy', select: 'name email' },
      ],
    });
  }

  async scanSurplus(userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);

    // 1. Fetch active products for restaurant
    const products = await this.productRepository.findMany({
      filters: { restaurantId, isDeleted: false },
    });

    if (!products || products.length === 0) {
      return {
        message: 'No products found for surplus scan',
        scannedCount: 0,
        itemsAtRisk: [],
      };
    }

    // 2. Fetch today's DailyProductionPlan for restaurant (if available)
    const todayStr = new Date().toISOString().split('T')[0];
    const dailyProductionPlan =
      await this.dailyProductionPlanRepository.findOne({
        filters: { restaurantId, date: todayStr, isDeleted: false },
      });

    const wasteReportData: Array<{
      predictionId?: Types.ObjectId;
      productId: Types.ObjectId;
      ingredientId: Types.ObjectId;
      title: string;
      usableAvailableStock: number;
      expectedConsumption: number;
      expectedSurplus: number;
      riskLevel: RiskLevelEnum;
    }> = [];

    const stockItems: Array<{
      productId: string;
      title: string;
      category: string;
      price: number;
      freshnessWindow: number;
      currentStock: number;
      avgDailySales: number;
    }> = [];

    // Track which products have genuine surplus locally
    const productsWithSurplus = new Set<string>();

    for (const product of products) {
      const recipe = await this.recipeRepository.findOne({
        filters: { productId: product._id, isDeleted: false },
      });

      if (!recipe?.ingredients?.length) continue;

      // Get latest prediction once per product
      const prodObjectId = new Types.ObjectId(product._id.toString());
      const restObjectId = new Types.ObjectId(restaurantId.toString());
      const predictions = await this.predictionRepository.findMany({
        filters: {
          restaurantId: restObjectId,
          productId: prodObjectId,
          isDeleted: { $ne: true },
        },
        sort: { createdAt: -1 },
      });
      const prediction =
        predictions && predictions.length > 0 ? predictions[0] : null;

      // Find matching item in today's DailyProductionPlan (if present)
      const planItem = dailyProductionPlan?.items?.find(
        (item) => item.productId.toString() === product._id.toString(),
      );

      // Determine today's predicted orders from dailyBreakdown (YYYY-MM-DD) or fallback to daily average
      let todayPredictedOrders = 0;
      if (prediction && prediction.predictedOrders > 0) {
        const todayBreakdownItem = prediction.dailyBreakdown?.find(
          (d) => d.date && d.date.substring(0, 10) === todayStr,
        );

        if (todayBreakdownItem && todayBreakdownItem.predictedQuantity > 0) {
          todayPredictedOrders = todayBreakdownItem.predictedQuantity;
        } else if (prediction.dailyBreakdown?.length) {
          const totalPredicted = prediction.dailyBreakdown.reduce(
            (sum, d) => sum + d.predictedQuantity,
            0,
          );
          todayPredictedOrders = Math.round(
            totalPredicted / prediction.dailyBreakdown.length,
          );
        } else {
          todayPredictedOrders = Math.round(prediction.predictedOrders / 7);
        }
      }

      // Determine Ready-To-Sell Quantity by priority:
      // Priority 1: actualProducedQty (from today's DailyProductionPlan)
      // Priority 2: recommendedQty (from today's DailyProductionPlan)
      // Priority 3: todayPredictedOrders (from Prediction fallback)
      // Priority 4: Abort scan for product if no source is available
      let readyToSellStock = 0;
      if (
        planItem &&
        planItem.actualProducedQty !== undefined &&
        planItem.actualProducedQty !== null &&
        planItem.actualProducedQty > 0
      ) {
        readyToSellStock = planItem.actualProducedQty;
      } else if (
        planItem &&
        planItem.recommendedQty !== undefined &&
        planItem.recommendedQty !== null &&
        planItem.recommendedQty > 0
      ) {
        readyToSellStock = planItem.recommendedQty;
      } else if (todayPredictedOrders > 0) {
        readyToSellStock = todayPredictedOrders;
      } else {
        this.logger.log(
          `Skipping surplus scan for product ${product.title} (${product._id.toString()}) — no ready-to-sell stock source (production plan / prediction) available`,
        );
        continue;
      }

      // If todayPredictedOrders is 0 (e.g. prediction absent but production plan present),
      // use readyToSellStock as today's target demand to ensure expectedConsumption is correctly computed
      if (todayPredictedOrders <= 0 && readyToSellStock > 0) {
        todayPredictedOrders = readyToSellStock;
      }

      const avgDailySales = todayPredictedOrders;

      for (const recipeIngredient of recipe.ingredients) {
        const nonExpiredBatches = await this.inventoryBatchRepository.findMany({
          filters: {
            restaurantId,
            ingredientId: recipeIngredient.ingredientId,
            isDeleted: false,
            expiryDate: { $gte: new Date() },
          },
        });

        const usableAvailableStock = nonExpiredBatches.reduce(
          (sum, b) => sum + (b.quantityRemaining || 0),
          0,
        );

        // Account for recipe yieldPercentage
        const yieldFactor = (recipeIngredient.yieldPercentage || 100) / 100;
        const rawQuantityPerPortion =
          yieldFactor > 0
            ? recipeIngredient.quantityPerPortion / yieldFactor
            : recipeIngredient.quantityPerPortion;

        const expectedConsumption =
          Math.round(todayPredictedOrders * rawQuantityPerPortion * 100) / 100;
        const expectedSurplus =
          Math.round(
            Math.max(0, usableAvailableStock - expectedConsumption) * 100,
          ) / 100;

        const surplusRatio =
          usableAvailableStock > 0 ? expectedSurplus / usableAvailableStock : 0;

        let riskLevel = RiskLevelEnum.LOW;
        if (expectedSurplus > 0) {
          if (surplusRatio >= 0.7) {
            riskLevel = RiskLevelEnum.HIGH;
          } else if (surplusRatio >= 0.4) {
            riskLevel = RiskLevelEnum.MEDIUM;
          }
        }

        // Only include in waste reports if there is actual expected surplus / risk
        if (expectedSurplus > 0 && riskLevel !== RiskLevelEnum.LOW) {
          productsWithSurplus.add(product._id.toString());

          wasteReportData.push({
            predictionId: prediction?._id,
            productId: product._id,
            ingredientId: recipeIngredient.ingredientId,
            title: product.title,
            usableAvailableStock,
            expectedConsumption,
            expectedSurplus,
            riskLevel,
          });
        }
      }

      stockItems.push({
        productId: product._id.toString(),
        title: product.title || 'Product',
        category: 'General',
        price: product.price || 0,
        freshnessWindow: product.freshnessWindow || 2,
        currentStock: readyToSellStock,
        avgDailySales,
      });
    }

    if (stockItems.length === 0) {
      return {
        message: 'No products with predictions found for surplus scan',
        scannedCount: 0,
        itemsAtRisk: [],
      };
    }

    // 3. Upsert WasteReports ONLY for actual waste risk items
    // Track waste report IDs per product to link only when naturally 1-to-1
    const wasteReportsByProduct = new Map<string, Types.ObjectId[]>();

    for (const data of wasteReportData) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      let wasteReport = await this.wasteReportRepository.findOne({
        filters: {
          restaurantId,
          ingredientId: data.ingredientId,
          isDeleted: false,
          createdAt: { $gte: todayStart, $lte: todayEnd },
        },
      });

      if (wasteReport) {
        wasteReport = await this.wasteReportRepository.update({
          filters: { _id: wasteReport._id },
          body: {
            predictionId: data.predictionId,
            expectedConsumption: data.expectedConsumption,
            usableAvailableStock: data.usableAvailableStock,
            expectedSurplus: data.expectedSurplus,
            riskLevel: data.riskLevel,
          } as any,
        });
      } else {
        wasteReport = await this.wasteReportRepository.create({
          restaurantId,
          predictionId: data.predictionId,
          ingredientId: data.ingredientId,
          expectedConsumption: data.expectedConsumption,
          usableAvailableStock: data.usableAvailableStock,
          expectedSurplus: data.expectedSurplus,
          riskLevel: data.riskLevel,
          isDeleted: false,
        } as any);
      }

      if (wasteReport) {
        const prodKey = data.productId.toString();
        const list = wasteReportsByProduct.get(prodKey) || [];
        list.push(wasteReport._id);
        wasteReportsByProduct.set(prodKey, list);
      }
    }

    // 4. Call AI Microservice for recommendation suggestions
    const aiBaseUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8200';
    const aiEndpoint = `${aiBaseUrl.replace(/\/$/, '')}/integration/restomind/surplus-offers`;

    let aiData: any = null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(aiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId: restaurantId.toString(),
          timestamp: new Date().toISOString(),
          closeHour: 22,
          stock: stockItems,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        aiData = await response.json();
      } else {
        this.logger.warn(
          `AI surplus-offers endpoint returned status ${response.status}`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `AI surplus-offers request failed: ${err?.message || err}`,
      );
    }

    if (!aiData || !aiData.itemsAtRisk) {
      throw new ServiceUnavailableException(
        'AI service temporarily unavailable — showing last computed report',
      );
    }

    // 5. Create/update Recommendations using AI suggestions ONLY for products with backend-verified surplus
    const createdRecommendations: any[] = [];
    const verifiedItemsAtRisk: any[] = [];

    for (const item of aiData.itemsAtRisk) {
      this.validateObjectId(item.productId);
      const prodKey = item.productId.toString();

      // BACKEND BUSINESS VALIDATION: Ensure recommendation is created ONLY if surplus exists locally
      if (!productsWithSurplus.has(prodKey)) {
        this.logger.log(
          `Skipping AI recommendation for product ${prodKey} — no local surplus risk detected`,
        );
        continue;
      }

      verifiedItemsAtRisk.push(item);
      const prodObjectId = new Types.ObjectId(item.productId);

      // Link wasteReportId to the primary generated WasteReport for this product
      const reports = wasteReportsByProduct.get(prodKey);
      const wasteReportId = reports && reports.length > 0 ? reports[0] : null;

      let rec = await this.recommendationRepository.findOne({
        filters: {
          restaurantId,
          productId: prodObjectId,
          status: RecommendationStatusEnum.PENDING,
          isDeleted: false,
        },
      });

      if (!rec) {
        rec = await this.recommendationRepository.create({
          restaurantId,
          wasteReportId,
          productId: prodObjectId,
          type: RecommendationTypeEnum.APPLY_DISCOUNT,
          suggestedValue: item.suggestedDiscountPct || 20,
          gptExplanation:
            item.offerCopyAr || `Surplus discount suggested for ${item.title}`,
          status: RecommendationStatusEnum.PENDING,
        } as any);
      } else {
        await this.recommendationRepository.update({
          filters: { _id: rec._id },
          body: {
            wasteReportId,
            suggestedValue: item.suggestedDiscountPct || rec.suggestedValue,
            gptExplanation: item.offerCopyAr || rec.gptExplanation,
          } as any,
        });
      }
      createdRecommendations.push(rec);
    }

    return {
      message: 'Surplus scan completed',
      checkedAt: aiData.checkedAt || new Date().toISOString(),
      itemsAtRiskCount: verifiedItemsAtRisk.length,
      itemsAtRisk: verifiedItemsAtRisk,
      recommendations: createdRecommendations,
    };
  }

  async editRecommendation(
    id: string,
    userId: string,
    dto: EditRecommendationDto,
  ) {
    this.validateObjectId(id);
    const restaurantId = await this.getManagerRestaurantId(userId);

    const rec = await this.recommendationRepository.findOne({
      filters: { _id: new Types.ObjectId(id), restaurantId, isDeleted: false },
    });

    if (!rec) {
      throw new NotFoundException(`Recommendation with ID ${id} not found`);
    }

    if (
      rec.status === RecommendationStatusEnum.APPROVED ||
      rec.status === RecommendationStatusEnum.DISMISSED
    ) {
      throw new BadRequestException(
        `Cannot edit recommendation with status ${rec.status}`,
      );
    }

    return this.recommendationRepository.update({
      filters: { _id: rec._id },
      body: {
        suggestedValue: dto.suggestedValue,
        status: RecommendationStatusEnum.EDITED,
      } as any,
    });
  }

  async dismissRecommendation(id: string, userId: string) {
    this.validateObjectId(id);
    const restaurantId = await this.getManagerRestaurantId(userId);

    const rec = await this.recommendationRepository.findOne({
      filters: { _id: new Types.ObjectId(id), restaurantId, isDeleted: false },
    });

    if (!rec) {
      throw new NotFoundException(`Recommendation with ID ${id} not found`);
    }

    return this.recommendationRepository.update({
      filters: { _id: rec._id },
      body: {
        status: RecommendationStatusEnum.DISMISSED,
        reviewedBy: new Types.ObjectId(userId),
      } as any,
    });
  }

  async approveRecommendation(
    id: string,
    userId: string,
    dto: ApproveRecommendationDto,
  ) {
    this.validateObjectId(id);
    const restaurantId = await this.getManagerRestaurantId(userId);

    // 1. Fetch Recommendation
    const rec = await this.recommendationRepository.findOne({
      filters: { _id: new Types.ObjectId(id), restaurantId, isDeleted: false },
    });

    if (!rec) {
      throw new NotFoundException(`Recommendation with ID ${id} not found`);
    }

    if (rec.status === RecommendationStatusEnum.APPROVED) {
      throw new BadRequestException('Recommendation has already been approved');
    }

    if (rec.status === RecommendationStatusEnum.DISMISSED) {
      throw new BadRequestException(
        'Cannot approve a dismissed recommendation',
      );
    }

    if (rec.type !== RecommendationTypeEnum.APPLY_DISCOUNT) {
      throw new BadRequestException(
        `Approval workflow only supports '${RecommendationTypeEnum.APPLY_DISCOUNT}' recommendations`,
      );
    }

    // 2. Read Product fresh (read-only — Product is never written to!)
    const product = await this.productRepository.findOne({
      filters: { _id: rec.productId, isDeleted: false },
    });

    if (!product) {
      throw new NotFoundException(
        'Product associated with recommendation not found',
      );
    }

    // 3. Overlapping-offer check (Phase 0B rule)
    const existingOffers = await this.offerRepository.findMany({
      filters: {
        productId: rec.productId,
        isDeleted: false,
        status: { $in: [OfferStatusEnum.ACTIVE, OfferStatusEnum.SCHEDULED] },
      },
    });

    if (existingOffers && existingOffers.length > 0) {
      throw new ConflictException(
        'An active or scheduled offer already exists for this product',
      );
    }

    // 4. Compute Offer values
    const originalPrice = product.price;
    const discountPercentage =
      dto.discountPercentage ?? rec.suggestedValue ?? 10;
    const offerPrice =
      Math.round(originalPrice * (1 - discountPercentage / 100) * 100) / 100;
    const availableQuantity = dto.availableQuantity ?? 10;

    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const endDate = dto.endDate
      ? new Date(dto.endDate)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    // 5. Create Offer
    const offer = await this.offerRepository.create({
      productId: rec.productId,
      restaurantId,
      originalPrice,
      offerPrice,
      discountPercentage,
      availableQuantity,
      remainingQuantity: availableQuantity,
      maxPerCustomer: dto.maxPerCustomer || null,
      startDate,
      endDate,
      status: OfferStatusEnum.ACTIVE,
      source: OfferSourceEnum.AI_RECOMMENDATION,
      recommendationId: rec._id,
      createdBy: new Types.ObjectId(userId),
    } as any);

    // 6. Update Recommendation status = 'approved'
    const updatedRec = await this.recommendationRepository.update({
      filters: { _id: rec._id },
      body: {
        status: RecommendationStatusEnum.APPROVED,
        reviewedBy: new Types.ObjectId(userId),
      } as any,
    });

    return {
      message: 'Recommendation approved and offer created successfully',
      recommendation: updatedRec,
      offer,
    };
  }

  async validatePlan(userId: string, dto: ValidatePlanDto) {
    await this.getManagerRestaurantId(userId);

    const aiBaseUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8200';
    const aiEndpoint = `${aiBaseUrl.replace(/\/$/, '')}/alerts/waste-prevention`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(aiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: dto.sku,
          date: dto.date || new Date().toISOString().split('T')[0],
          planned_quantity: dto.planned_quantity,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return await response.json();
      }
    } catch (err: any) {
      this.logger.warn(
        `AI waste-prevention request failed: ${err?.message || err}`,
      );
    }

    throw new ServiceUnavailableException(
      'AI service temporarily unavailable for plan validation',
    );
  }
}
