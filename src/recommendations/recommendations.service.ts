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
import { AiClientService } from 'src/Common/Services/ai-client.service';
import { getBusinessDateString } from 'src/Common/Utils/date.util';
import {
  OfferSourceEnum,
  OfferStatusEnum,
  RecommendationStatusEnum,
  RecommendationTypeEnum,
  RiskLevelEnum,
} from 'src/Common/Types';
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
import { ApproveRecommendationDto } from './dto/approve-recommendation.dto';
import { EditRecommendationDto } from './dto/edit-recommendation.dto';
import { QueryRecommendationDto } from './dto/query-recommendation.dto';
import { ValidatePlanDto } from './dto/validate-plan.dto';

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly aiClient: AiClientService,
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
        data: {
          message: 'No products found for surplus scan',
          scannedCount: 0,
          itemsAtRisk: [],
          recommendations: [],
        },
        degraded: false,
      };
    }

    // 2. Process each product: resolve recipe, calculate ingredient-level data
    const wasteReportData: Array<{
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

    for (const product of products) {
      const recipe = await this.recipeRepository.findOne({
        filters: { productId: product._id, isDeleted: false },
      });

      if (!recipe?.ingredients?.length) continue;

      let productTotalStock = 0;

      // Get prediction once per product
      const prediction = await this.predictionRepository.findOne({
        filters: { restaurantId, productId: product._id, isDeleted: false },
      });

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

        const predictedOrders = prediction?.predictedOrders ?? 0;
        const quantityPerPortion = recipeIngredient.quantityPerPortion;
        const expectedConsumption = predictedOrders * quantityPerPortion;
        const expectedSurplus = Math.max(
          0,
          usableAvailableStock - expectedConsumption,
        );

        const surplusRatio =
          usableAvailableStock > 0 ? expectedSurplus / usableAvailableStock : 0;

        let riskLevel = RiskLevelEnum.LOW;
        if (surplusRatio >= 0.7) {
          riskLevel = RiskLevelEnum.HIGH;
        } else if (surplusRatio >= 0.4) {
          riskLevel = RiskLevelEnum.MEDIUM;
        }

        wasteReportData.push({
          productId: product._id,
          ingredientId: recipeIngredient.ingredientId,
          title: product.title,
          usableAvailableStock,
          expectedConsumption,
          expectedSurplus,
          riskLevel,
        });

        productTotalStock += usableAvailableStock;
      }

      // Calculate avgDailySales from prediction or sales history
      let avgDailySales = 0;
      if (prediction?.predictedOrders) {
        if (prediction.dailyBreakdown?.length) {
          const totalPredicted = prediction.dailyBreakdown.reduce(
            (sum, d) => sum + d.predictedQuantity,
            0,
          );
          avgDailySales = Math.round(
            totalPredicted / prediction.dailyBreakdown.length,
          );
        } else {
          avgDailySales = Math.round(prediction.predictedOrders / 7);
        }
      } else {
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

        const sales = await this.salesTransactionRepository.findMany({
          filters: {
            restaurantId,
            productId: product._id,
            isDeleted: false,
            date: { $gte: fourteenDaysAgo },
          },
        });

        if (sales?.length) {
          const totalSold = sales.reduce(
            (sum, s) => sum + (s.quantitySold || 0),
            0,
          );
          avgDailySales = Math.round(totalSold / 14);
        }
      }

      stockItems.push({
        productId: product._id.toString(),
        title: product.title || 'Product',
        category: 'General',
        price: product.price || 0,
        freshnessWindow: product.freshnessWindow || 2,
        currentStock: productTotalStock,
        avgDailySales,
      });
    }

    if (stockItems.length === 0) {
      return {
        data: {
          message: 'No products with recipes found for surplus scan',
          scannedCount: 0,
          itemsAtRisk: [],
          recommendations: [],
        },
        degraded: false,
      };
    }

    // 3. Upsert WasteReports with locally calculated values
    const wasteReportsByProduct = new Map<string, Types.ObjectId>();

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
            expectedConsumption: data.expectedConsumption,
            usableAvailableStock: data.usableAvailableStock,
            expectedSurplus: data.expectedSurplus,
            riskLevel: data.riskLevel,
          } as any,
        });
      } else {
        wasteReport = await this.wasteReportRepository.create({
          restaurantId,
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
        if (!wasteReportsByProduct.has(prodKey)) {
          wasteReportsByProduct.set(prodKey, wasteReport._id);
        }
      }
    }

    // 4. Ask the AI for discount suggestions. A failure here does NOT invalidate
    // the waste reports we just wrote — report them as degraded instead of
    // throwing on top of a committed write.
    const aiResult = await this.aiClient.post<any>(
      '/integration/restomind/surplus-offers',
      {
        restaurantId: restaurantId.toString(),
        timestamp: new Date().toISOString(),
        closeHour: 22,
        stock: stockItems,
      },
      { retries: 2, timeoutMs: 8000 },
    );

    if (!aiResult.ok || !aiResult.data?.itemsAtRisk) {
      const reason = aiResult.ok
        ? 'AI service returned no itemsAtRisk'
        : aiResult.message;
      this.logger.warn(`Surplus scan degraded: ${reason}`);
      return {
        data: {
          message: 'Surplus scan completed without AI recommendations',
          checkedAt: new Date().toISOString(),
          itemsAtRiskCount: 0,
          itemsAtRisk: [],
          recommendations: [],
          wasteReportsWritten: wasteReportData.length,
        },
        degraded: true,
        degradedReason: reason,
      };
    }

    const aiData = aiResult.data;

    // 5. Create/update Recommendations using AI suggestions
    const createdRecommendations: any[] = [];
    for (const item of aiData.itemsAtRisk) {
      this.validateObjectId(item.productId);
      const prodObjectId = new Types.ObjectId(item.productId);

      const wasteReportId = wasteReportsByProduct.get(item.productId);

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
      data: {
        message: 'Surplus scan completed',
        checkedAt: aiData.checkedAt || new Date().toISOString(),
        itemsAtRiskCount: aiData.itemsAtRisk.length,
        itemsAtRisk: aiData.itemsAtRisk,
        recommendations: createdRecommendations,
        wasteReportsWritten: wasteReportData.length,
      },
      degraded: false,
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

    const result = await this.aiClient.post<any>(
      '/alerts/waste-prevention',
      {
        sku: dto.sku,
        date: dto.date || getBusinessDateString(),
        planned_quantity: dto.planned_quantity,
      },
      { retries: 2, timeoutMs: 8000 },
    );

    if (result.ok) {
      return { data: result.data, degraded: false };
    }

    // A 4xx means the SKU is unknown — the service returns the valid list in
    // `hint`. Surfacing that as a 503 outage hid a usable error message.
    if (result.kind === 'client_error') {
      const hint = (result.body as any)?.hint;
      throw new BadRequestException(
        hint ? `${result.message}. ${hint}` : result.message,
      );
    }

    throw new ServiceUnavailableException(
      `AI service unavailable for plan validation: ${result.message}`,
    );
  }
}
