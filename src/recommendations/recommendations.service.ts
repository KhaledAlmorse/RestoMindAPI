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
import { ProductCostService } from 'src/Common/Services/product-cost.service';
import {
  addDaysToDateString,
  getBusinessDateString,
  getBusinessDayOfWeek,
  getBusinessDayRange,
} from 'src/Common/Utils/date.util';
import {
  AVG_DAILY_SALES_LOOKBACK_DAYS,
  resolveDailySalesEstimate,
} from 'src/Common/Utils/sales-estimate.util';
import {
  degradationFields,
  reportAiFailure,
} from 'src/Common/Utils/ai-degradation.util';
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
  private readonly reusableRecommendationStatuses = [
    RecommendationStatusEnum.PENDING,
    RecommendationStatusEnum.EDITED,
  ];

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
    private readonly dailyProductionPlanRepository: DailyProductionPlanRepository,
    private readonly productCostService: ProductCostService,
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

  /**
   * The week the surplus scan reasons about. Mirrors
   * WeeklyPredictionService.resolveTargetWeek; duplicated deliberately rather
   * than importing that service, to keep the two feature modules decoupled.
   */
  private currentTargetWeek(): string {
    const today = getBusinessDateString();
    const dayOfWeek = getBusinessDayOfWeek();
    // The week in progress started on the most recent Sunday.
    return addDaysToDateString(today, -dayOfWeek);
  }

  async scanSurplus(userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    return this.scanSurplusForRestaurant(restaurantId);
  }

  /**
   * The actual surplus scan, once `restaurantId` is already known.
   *
   * Split out of `scanSurplus` so a caller that already has a restaurantId --
   * the assistant's `RecommendationService`, notably, which used to run a
   * fully separate, hardcoded discount engine that never called the AI
   * service at all -- can get the same real, AI-backed, backend-verified
   * surplus recommendations without going through a userId round-trip or
   * duplicating this method's request-building and persistence logic.
   */
  async scanSurplusForRestaurant(restaurantId: Types.ObjectId) {
    const targetWeek = this.currentTargetWeek();

    // 1. Fetch active products for restaurant
    const products = await this.productRepository.findMany({
      filters: { restaurantId, isDeleted: false },
      populationArray: [{ path: 'category' }],
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

    // 2. Fetch today's DailyProductionPlan for restaurant (if available).
    // `DailyProductionPlan.date` and `Prediction.dailyBreakdown[].date` are
    // CAIRO calendar dates — `new Date().toISOString().split('T')[0]` is the
    // UTC date, a day behind between Cairo 00:00 and 02:00, so a scan in that
    // window looked up yesterday's plan and yesterday's breakdown row.
    const todayStr = getBusinessDateString();
    const dailyProductionPlan =
      await this.dailyProductionPlanRepository.findOne({
        filters: { restaurantId, date: todayStr, isDeleted: false },
      });
    // Cairo day boundaries, shared by the "sold so far today" lookup below and
    // the WasteReport dedup window further down (moved up so both use one
    // computation instead of two).
    const { start: todayStart, end: todayEnd } = getBusinessDayRange(todayStr);

    const wasteReportData: Array<{
      predictionId: Types.ObjectId | null;
      productId: Types.ObjectId;
      ingredientId: Types.ObjectId;
      title: string;
      usableAvailableStock: number;
      expectedConsumption: number;
      expectedSurplus: number;
      riskLevel: RiskLevelEnum;
    }> = [];

    // Real unit_cost lets the AI service floor a surplus discount above cost
    // instead of only capping it by risk. `null` (no recipe/never purchased)
    // keeps the old cap-only behaviour.
    const unitCosts = await this.productCostService.getUnitCosts(
      restaurantId,
      products.map((p: any) => p._id),
    );

    const stockItems: Array<{
      productId: string;
      title: string;
      category: string | null;
      price: number;
      unitCost: number | null;
      freshnessWindow: number;
      currentStock: number;
      // `null`, NOT 0. The bridge reads 0 as "this product sells nothing" and
      // scores it as pure surplus risk; it reads null as "no estimate given"
      // and applies its category default. Typing this as `number` and seeding
      // it to 0 collapsed the two, and the Python side's truthy
      // `s.avg_daily_sales or DEFAULT_DAILY_LEVEL` then turned an honest 0
      // into 40/day, so dead-slow stock was never flagged or discounted.
      avgDailySales: number | null;
      // Present only when avgDailySales was averaged over real or forecast days.
      // See the comment where it is built: the AI applies today's calendar
      // multiplier on top, so a figure carrying its own calendar must say so.
      avgDailySalesWindow?: { from: string; to: string };
    }> = [];

    for (const product of products) {
      // A recipe is optional. When present it drives the ingredient-level
      // waste-report check below (recipe consumption vs. batch stock); when
      // absent, the product still gets a full finished-goods surplus check
      // from real currentStock — recommendations no longer require a recipe
      // to exist.
      const recipe = await this.recipeRepository.findOne({
        filters: { productId: product._id, isDeleted: false },
      });
      const hasRecipe = !!recipe?.ingredients?.length;

      // Get this week's prediction once per product.
      // Without a targetWeek filter this returned natural order — in practice
      // the OLDEST prediction — so today's discount was driven by a months-old
      // forecast. `{restaurantId, productId, targetWeek}` is the unique index
      // on Prediction, so this is a single indexed hit rather than loading
      // every prediction ever made for the product and taking element [0].
      const prediction = await this.predictionRepository.findOne({
        filters: {
          restaurantId,
          productId: product._id,
          targetWeek,
          isDeleted: false,
        },
      });

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

      // Today's target DEMAND, for the ingredient-consumption math below.
      // Falls back to the production plan's recommendedQty — also a demand
      // estimate (what the AI recommended making), not a stock figure — when
      // no prediction exists. No basis at all means the ingredient check has
      // nothing to compare against either, so the product is skipped entirely.
      if (todayPredictedOrders <= 0 && planItem?.recommendedQty) {
        todayPredictedOrders = planItem.recommendedQty;
      }
      if (todayPredictedOrders <= 0) {
        this.logger.log(
          `Skipping surplus scan for product ${product.title} (${product._id.toString()}) — no demand estimate (prediction / production plan) available`,
        );
        continue;
      }

      // Real unsold units on hand right now, for the AI surplus call's `currentStock`.
      // Prefers manager-confirmed `actualProducedQty`. If unconfirmed (e.g. fresh CSV import or cold start),
      // falls back to estimated baseline stock from historical sales/production so surplus offers work natively.
      let currentStock: number | null = null;
      if (
        planItem &&
        planItem.actualProducedQty !== undefined &&
        planItem.actualProducedQty !== null
      ) {
        const soldToday = await this.salesTransactionRepository.findMany({
          filters: {
            restaurantId,
            productId: product._id,
            isDeleted: false,
            date: { $gte: todayStart, $lt: todayEnd },
          },
        });
        const unitsSoldToday = (soldToday || []).reduce(
          (sum, s) => sum + (s.quantitySold || 0),
          0,
        );
        currentStock = Math.max(0, planItem.actualProducedQty - unitsSoldToday);
      }

      // Ingredient-level waste-report check: needs a recipe to translate
      // demand into raw-ingredient consumption. Purely additive -- it feeds
      // WasteReport analytics and an optional wasteReportId link below, but
      // (unlike before) is no longer required for the finished-goods
      // recommendation itself.
      if (hasRecipe) {
        for (const recipeIngredient of recipe.ingredients) {
          const nonExpiredBatches =
            await this.inventoryBatchRepository.findMany({
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
            Math.round(todayPredictedOrders * rawQuantityPerPortion * 100) /
            100;
          const expectedSurplus =
            Math.round(
              Math.max(0, usableAvailableStock - expectedConsumption) * 100,
            ) / 100;

          const surplusRatio =
            usableAvailableStock > 0
              ? expectedSurplus / usableAvailableStock
              : 0;

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
            wasteReportData.push({
              predictionId: (prediction as any)?._id ?? null,
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
      }

      // No confirmed production yet -> no real stock-on-hand figure -> nothing
      // to hand the AI surplus check for this product (see currentStock above).
      if (currentStock === null) {
        this.logger.log(
          `Product ${product.title} (${product._id.toString()}) has no confirmed actualProducedQty yet — excluding from AI surplus check`,
        );
        continue;
      }

      // Calculate avgDailySales from this week's forecast, else from history.
      //
      // Two defects lived here. (1) `Math.round(...)` to a whole unit meant any
      // product forecast under 4 units/week became a flat 0 — an ordinary
      // outcome, not a cold-start edge case. (2) the initial `0` and the
      // `number` type meant "no signal at all" was sent as 0, which the bridge
      // reads as a real zero-demand answer. Both now go through the same
      // measured > owner estimate > null precedence the other two AI-feeding
      // paths use.
      let avgDailySales: number | null;
      const predictedOrders = prediction?.predictedOrders;

      // The window `avgDailySales` was averaged over, when it was averaged over
      // anything. The AI multiplies whatever we send by TODAY's calendar
      // multiplier, so a figure that already carries a window's calendar has to
      // arrive labelled with it — otherwise the effect is applied twice.
      let avgDailySalesWindow: { from: string; to: string } | undefined;

      if (predictedOrders !== undefined && predictedOrders !== null) {
        const breakdown = prediction?.dailyBreakdown;
        const days = breakdown?.length || 7;
        const total = breakdown?.length
          ? breakdown.reduce((sum, d) => sum + d.predictedQuantity, 0)
          : predictedOrders;
        // Two decimals, matching resolveDailySalesEstimate — never rounded to 0.
        avgDailySales = Math.round((total / days) * 100) / 100;
        // A prediction average is not a neutral level: the forecast already
        // applied the target week's calendar to produce it. That week IS its
        // window.
        avgDailySalesWindow = {
          from: targetWeek,
          to: addDaysToDateString(targetWeek, 6),
        };
      } else {
        const lookbackStart = new Date();
        lookbackStart.setDate(
          lookbackStart.getDate() - AVG_DAILY_SALES_LOOKBACK_DAYS,
        );

        const sales =
          (await this.salesTransactionRepository.findMany({
            filters: {
              restaurantId,
              productId: product._id,
              isDeleted: false,
              date: { $gte: lookbackStart },
            },
          })) || [];

        const totalSold = sales.reduce(
          (sum, s) => sum + (s.quantitySold || 0),
          0,
        );
        const estimate = resolveDailySalesEstimate(
          totalSold,
          sales.length,
          product as any,
          todayStr,
        );
        avgDailySales = estimate.value;
        avgDailySalesWindow = estimate.window;
      }

      const categoryName =
        product.category &&
        typeof product.category === 'object' &&
        (product.category as any).name
          ? (product.category as any).name
          : null;

      stockItems.push({
        productId: product._id.toString(),
        title: product.title || 'Product',
        // 'General' matched no market-prior keyword, so every product resolved
        // to neutral priors and surplus risk was never category-aware.
        category: categoryName,
        price: product.price || 0,
        unitCost: unitCosts.get(product._id.toString()) ?? null,
        freshnessWindow: product.freshnessWindow || 2,
        currentStock,
        avgDailySales,
        ...(avgDailySalesWindow ? { avgDailySalesWindow } : {}),
      });
    }

    if (stockItems.length === 0 && wasteReportData.length === 0) {
      return {
        data: {
          message:
            'No products with a ready-to-sell source found for surplus scan',
          scannedCount: 0,
          itemsAtRisk: [],
          recommendations: [],
        },
        degraded: false,
      };
    }

    // 3. Upsert WasteReports for the ingredients that carry real surplus risk.
    // Independent of stockItems/currentStock below -- this is the raw-ingredient
    // check, driven by demand vs. inventory batches, and runs even for a
    // product with no confirmed actualProducedQty yet.
    // The dedup window is one CAIRO day. `setHours(0,0,0,0)` used the server's
    // local day, so on a UTC-timezone container a scan at Cairo 01:00 and one
    // at Cairo 10:00 on the same Cairo day landed in different windows and
    // wrote two reports per ingredient — double-counting getSummary's
    // `$sum` on totalEstimatedWasteCost.
    // First report per product wins the link — a product's recommendation
    // points at one waste report.
    const wasteReportsByProduct = new Map<string, Types.ObjectId>();

    for (const data of wasteReportData) {
      let wasteReport = await this.wasteReportRepository.findOne({
        filters: {
          restaurantId,
          ingredientId: data.ingredientId,
          isDeleted: false,
          createdAt: { $gte: todayStart, $lt: todayEnd },
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
        if (!wasteReportsByProduct.has(prodKey)) {
          wasteReportsByProduct.set(prodKey, wasteReport._id);
        }
      }
    }

    // 4. Ask the AI for discount suggestions -- only when at least one product
    // has a real currentStock figure (the AI schema requires a non-empty
    // `stock` array). A restaurant where nothing has confirmed today's
    // production yet still gets its waste reports written above; it just has
    // no basis yet for a discount suggestion.
    if (stockItems.length === 0) {
      return {
        data: {
          message:
            'Surplus scan completed without AI recommendations — no product has a confirmed production quantity for today yet',
          checkedAt: new Date().toISOString(),
          itemsAtRiskCount: 0,
          itemsAtRisk: [],
          recommendations: [],
          wasteReportsWritten: wasteReportData.length,
        },
        degraded: false,
      };
    }

    // A failure here does NOT invalidate the waste reports we just wrote —
    // report them as degraded instead of throwing on top of a committed write.
    const restaurant = await this.restaurantRepository.findOne({
      filters: { _id: restaurantId, isDeleted: false },
    });
    const aiResult = await this.aiClient.post<any>(
      '/integration/restomind/surplus-offers',
      {
        restaurantId: restaurantId.toString(),
        timestamp: new Date().toISOString(),
        // Was a bare `22` with no way to ever become real. Restaurant.closingHour
        // defaults to 22 too, so this changes nothing until an owner sets theirs.
        closeHour: restaurant?.closingHour ?? 22,
        stock: stockItems,
      },
      { retries: 2, timeoutMs: 8000 },
    );

    if (!aiResult.ok || !aiResult.data?.itemsAtRisk) {
      // Branching on `ok` alone logged a never-retried 401 at WARN with the
      // same wording as a real outage. Classify by KIND so a configuration
      // fault is loud, and carry the kind into the response.
      const degradation = aiResult.ok
        ? {
            kind: 'unavailable' as const,
            reason: 'AI service returned no itemsAtRisk',
          }
        : reportAiFailure(
            this.logger,
            '/integration/restomind/surplus-offers',
            aiResult,
            `restaurant ${restaurantId.toString()}`,
          );

      if (aiResult.ok) {
        this.logger.warn(`Surplus scan degraded: ${degradation.reason}`);
      }

      return {
        data: {
          message: 'Surplus scan completed without AI recommendations',
          checkedAt: new Date().toISOString(),
          itemsAtRiskCount: 0,
          itemsAtRisk: [],
          recommendations: [],
          wasteReportsWritten: wasteReportData.length,
        },
        ...degradationFields(degradation),
      };
    }

    const aiData = aiResult.data;

    // 5. Create/update Recommendations from the AI's itemsAtRisk. The backend
    // verification is currentStock itself: every product it was computed for
    // has a manager-confirmed actualProducedQty minus real sales (see above),
    // not a self-referential planned figure -- so the AI's risk call on it is
    // already trustworthy without also requiring a separate, recipe-dependent
    // ingredient-level match (that used to gate this, and is why a product
    // with no recipe could never get a recommendation).
    const createdRecommendations: any[] = [];
    const verifiedItemsAtRisk: any[] = [];

    for (const item of aiData.itemsAtRisk) {
      this.validateObjectId(item.productId);
      const prodKey = item.productId.toString();

      verifiedItemsAtRisk.push(item);
      const prodObjectId = new Types.ObjectId(item.productId);

      const wasteReportId = wasteReportsByProduct.get(prodKey) ?? null;

      let rec = await this.recommendationRepository.findOne({
        filters: {
          restaurantId,
          productId: prodObjectId,
          status: { $in: this.reusableRecommendationStatuses },
          isDeleted: false,
        },
      });

      const suggestedQuantity =
        item.projectedSurplus ?? item.currentStock ?? null;

      if (!rec) {
        rec = await this.recommendationRepository.create({
          restaurantId,
          wasteReportId,
          productId: prodObjectId,
          type: RecommendationTypeEnum.APPLY_DISCOUNT,
          suggestedValue: item.suggestedDiscountPct || 20,
          suggestedQuantity,
          gptExplanation:
            item.offerCopyAr || `Surplus discount suggested for ${item.title}`,
          status: RecommendationStatusEnum.PENDING,
        } as any);
      } else {
        rec = await this.recommendationRepository.update({
          filters: { _id: rec._id },
          body: {
            wasteReportId,
            suggestedValue: item.suggestedDiscountPct || rec.suggestedValue,
            suggestedQuantity: suggestedQuantity ?? rec.suggestedQuantity,
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
        itemsAtRiskCount: verifiedItemsAtRisk.length,
        itemsAtRisk: verifiedItemsAtRisk,
        recommendations: createdRecommendations,
        wasteReportsWritten: wasteReportData.length,
      },
      degraded: false,
    };
  }

  private targetWeekForDate(dateStr: string): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
    return addDaysToDateString(dateStr, -weekday);
  }

  private async validateProductPlan(
    restaurantId: Types.ObjectId,
    dto: ValidatePlanDto,
  ) {
    if (!dto.productId) {
      throw new BadRequestException('productId is required');
    }

    this.validateObjectId(dto.productId);
    const productId = new Types.ObjectId(dto.productId);
    const date = dto.date || getBusinessDateString();
    const targetWeek = this.targetWeekForDate(date);

    const product = await this.productRepository.findOne({
      filters: { _id: productId, restaurantId, isDeleted: false },
    });

    if (!product) {
      throw new NotFoundException('Product not found for this restaurant');
    }

    const prediction = await this.predictionRepository.findOne({
      filters: {
        restaurantId,
        productId,
        targetWeek,
        isDeleted: false,
      },
    });

    let forecastQty = 0;
    const breakdown = prediction?.dailyBreakdown || [];
    const day = breakdown.find((d) => d.date?.substring(0, 10) === date);
    if (day && day.predictedQuantity > 0) {
      forecastQty = day.predictedQuantity;
    } else if (breakdown.length > 0) {
      const total = breakdown.reduce((sum, d) => sum + d.predictedQuantity, 0);
      forecastQty = Math.round(total / breakdown.length);
    } else if (prediction?.predictedOrders && prediction.predictedOrders > 0) {
      forecastQty = Math.round(prediction.predictedOrders / 7);
    }

    if (forecastQty <= 0) {
      const plan = await this.dailyProductionPlanRepository.findOne({
        filters: { restaurantId, date, isDeleted: false },
      });
      const planItem = plan?.items?.find(
        (item) => item.productId.toString() === productId.toString(),
      );
      forecastQty = planItem?.recommendedQty || 0;
    }

    if (forecastQty <= 0) {
      throw new BadRequestException(
        'No prediction or production-plan baseline exists for this product/date',
      );
    }

    const forecastUpper = Math.max(forecastQty, Math.round(forecastQty * 1.1));
    const excess = Math.max(0, dto.planned_quantity - forecastUpper);
    const ratio = excess / Math.max(forecastUpper, 1);
    const severity =
      excess <= 0
        ? 'none'
        : ratio > 0.5
          ? 'high'
          : ratio > 0.2
            ? 'medium'
            : 'low';
    const unitCost =
      (await this.productCostService.getUnitCost(restaurantId, productId)) ?? 0;

    return {
      data: {
        sku: dto.productId,
        productId: dto.productId,
        productTitle: product.title,
        date,
        planned_qty: dto.planned_quantity,
        forecast_qty: forecastQty,
        forecast_upper: forecastUpper,
        excess_qty: excess,
        severity,
        message:
          excess > 0
            ? `Planned ${dto.planned_quantity} exceeds the forecast upper bound of ${forecastUpper} by ${excess} units.`
            : 'Planned quantity is within the forecast range.',
        projected_waste_cost_egp: Math.round(excess * unitCost * 100) / 100,
        factors: prediction?.factors || [],
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

    // 3. Overlapping-offer check (Phase 0B rule), scoped to THIS restaurant.
    // Without restaurantId, another tenant's offer on the same product blocked
    // approval here.
    const existingOffers = await this.offerRepository.findMany({
      filters: {
        restaurantId,
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
    const rawDiscount = dto.discountPercentage ?? rec.suggestedValue ?? 10;
    // Clamp: rows written before EditRecommendationDto gained @Max(100) can
    // still carry a value that would make offerPrice negative.
    const discountPercentage = Math.min(100, Math.max(1, rawDiscount));
    const offerPrice =
      Math.round(originalPrice * (1 - discountPercentage / 100) * 100) / 100;
    const availableQuantity =
      dto.availableQuantity ?? rec.suggestedQuantity ?? 10;

    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const endDate = dto.endDate
      ? new Date(dto.endDate)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    if (endDate <= startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

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
    const restaurantId = await this.getManagerRestaurantId(userId);

    if (dto.productId) {
      return this.validateProductPlan(restaurantId, dto);
    }

    if (!dto.sku) {
      throw new BadRequestException('Either productId or sku is required');
    }

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

    // A 429 is not an outage either — say what it actually is, with the
    // Retry-After if the AI service gave one (docs 02 §2.3a).
    if (result.kind === 'rate_limited') {
      throw new ServiceUnavailableException(
        `AI service rate-limited the plan validation (HTTP 429)${
          result.retryAfter ? ` — retry after ${result.retryAfter}s` : ''
        }: ${result.message}`,
      );
    }

    throw new ServiceUnavailableException(
      `AI service unavailable for plan validation: ${result.message}`,
    );
  }
}
