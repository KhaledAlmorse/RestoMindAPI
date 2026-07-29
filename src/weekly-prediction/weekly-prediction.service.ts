import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import {
  ConfidenceLevelEnum,
  OfferStatusEnum,
  PredictionSourceEnum,
} from 'src/Common/Types';
import {
  BUSINESS_TIMEZONE,
  addDaysToDateString,
  getBusinessDateString,
  getBusinessDayOfWeek,
  getBusinessDayRange,
  isValidDateString,
} from 'src/Common/Utils/date.util';
import { Prediction, PredictionType } from 'src/DB/Models/prediction.model';
import { PredictionRepository } from 'src/DB/Repositories/prediction.repository';
import { ProductRepository } from 'src/DB/Repositories/product.repository';
import { SalesTransactionRepository } from 'src/DB/Repositories/sales-transaction.repository';
import { OfferRepository } from 'src/DB/Repositories/offer.repository';
import { UserRepository } from 'src/DB/Repositories/user.repository';
import { RestaurantRepository } from 'src/DB/Repositories/restaurant.repository';
import { SupplierAutoDraftService } from './services/supplier-auto-draft.service';
import { QueryPredictionsDto } from './dto/query-predictions.dto';
import { AiClientService } from 'src/Common/Services/ai-client.service';

export const AVG_DAILY_SALES_LOOKBACK_DAYS = 14;

/** Mirrors MIN_DAYS_FOR_LEARNED in prediction-model/app/integration/registry.py. */
export const MIN_DAYS_FOR_LEARNED = 14;

@Injectable()
export class WeeklyPredictionService {
  private readonly logger = new Logger(WeeklyPredictionService.name);

  constructor(
    private readonly aiClient: AiClientService,
    private readonly predictionRepository: PredictionRepository,
    private readonly productRepository: ProductRepository,
    private readonly salesTransactionRepository: SalesTransactionRepository,
    private readonly offerRepository: OfferRepository,
    private readonly userRepository: UserRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly supplierAutoDraftService: SupplierAutoDraftService,
    @InjectModel(Prediction.name)
    private readonly predictionModel: Model<PredictionType>,
  ) {}

  private validateObjectId(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  async getManagerRestaurantId(userId: string): Promise<Types.ObjectId> {
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
      throw new NotFoundException('Restaurant not found for manager');
    }

    return new Types.ObjectId(restaurant._id.toString());
  }

  /**
   * Helper to get next Sunday date string (YYYY-MM-DD) or validate supplied targetWeek
   */
  resolveTargetWeek(targetWeek?: string): string {
    if (targetWeek && isValidDateString(targetWeek)) {
      return targetWeek;
    }
    // Next Sunday, evaluated in Cairo. If today is Sunday we deliberately roll
    // forward a full week: the current week's plan is already in flight.
    const today = getBusinessDateString();
    const dayOfWeek = getBusinessDayOfWeek();
    const daysUntilNextSunday = (7 - dayOfWeek) % 7 || 7;
    return addDaysToDateString(today, daysUntilNextSunday);
  }

  /**
   * Helper to generate 7 daily dates starting from targetWeek
   */
  generateDailyDates(targetWeekStr: string): string[] {
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      dates.push(addDaysToDateString(targetWeekStr, i));
    }
    return dates;
  }

  /**
   * Distribute a weekly total evenly across the given dates so the daily rows
   * always sum EXACTLY to the total (the remainder goes to the first days,
   * rather than letting Math.round(total/7)*7 drift from total).
   */
  private distributeAcrossWeek(
    total: number,
    dates: string[],
  ): Array<{ date: string; predictedQuantity: number }> {
    const base = Math.floor(total / dates.length);
    const remainder = total - base * dates.length;
    return dates.map((d, i) => ({
      date: d,
      predictedQuantity: base + (i < remainder ? 1 : 0),
    }));
  }

  /**
   * Resolve if a promotion is active for product during targetWeek from Offer collection.
   * Requirement 7: Never use Product.discountedPrice.
   */
  async checkPromotionActive(
    restaurantId: Types.ObjectId,
    productId: Types.ObjectId,
    targetWeekStr: string,
  ): Promise<boolean> {
    const targetWeekStart = new Date(`${targetWeekStr}T00:00:00.000Z`);
    const targetWeekEnd = new Date(targetWeekStart);
    targetWeekEnd.setUTCDate(targetWeekEnd.getUTCDate() + 7);

    const activeOffer = await this.offerRepository.findOne({
      filters: {
        restaurantId,
        productId,
        status: {
          $in: [OfferStatusEnum.ACTIVE, OfferStatusEnum.SCHEDULED],
        },
        isDeleted: false,
        // Half-open window [start, start+7): an offer beginning on day 8 is
        // next week's promotion, not this one's.
        startDate: { $lt: targetWeekEnd },
        endDate: { $gte: targetWeekStart },
      },
    });

    return !!activeOffer;
  }

  /**
   * Single product prediction recalculation logic
   */
  async recalculateProductPrediction(
    restaurantId: Types.ObjectId,
    productId: Types.ObjectId,
    targetWeekStr: string,
  ) {
    const product = await this.productRepository.findOne({
      filters: { _id: productId, restaurantId, isDeleted: false },
      populationArray: [{ path: 'category' }],
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // 1. Calculate avgDailySales (14-day rolling mean)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - AVG_DAILY_SALES_LOOKBACK_DAYS);

    const recentSales = await this.salesTransactionRepository.findMany({
      filters: {
        restaurantId,
        productId,
        isDeleted: false,
        date: { $gte: startDate, $lte: endDate },
      },
    });

    const totalQtySold = (recentSales || []).reduce(
      (sum, s) => sum + (s.quantitySold || 0),
      0,
    );
    // Keep two decimals: rounding to an integer collapses low-volume products
    // to 0, which the model then treats as "no estimate" and replaces with its
    // DEFAULT_DAILY_LEVEL of 40.
    const avgDailySales =
      Math.round((totalQtySold / AVG_DAILY_SALES_LOOKBACK_DAYS) * 100) / 100;

    // 2. Check promotionActive from Offer collection (Requirement 7)
    const promotionActive = await this.checkPromotionActive(
      restaurantId,
      productId,
      targetWeekStr,
    );

    const categoryName =
      product.category &&
      typeof product.category === 'object' &&
      (product.category as any).name
        ? (product.category as any).name
        : 'General';

    // 3. Call the AI microservice through the shared client.
    const aiResult = await this.aiClient.post<any>(
      '/integration/restomind/predict',
      {
        restaurantId: restaurantId.toString(),
        productId: productId.toString(),
        title: product.title,
        category: categoryName,
        targetWeek: targetWeekStr,
        avgDailySales,
        promotionActive,
      },
    );

    const aiResponse =
      aiResult.ok && aiResult.data?.predictedOrders !== undefined
        ? aiResult.data
        : null;

    const dailyDates = this.generateDailyDates(targetWeekStr);

    let modelVersionId = 'restomind-bridge/rule_based-v0.1';
    let predictedOrders = 0;
    let confidence = ConfidenceLevelEnum.MEDIUM;
    let source = PredictionSourceEnum.AI_MODEL;
    let featuresUsed: Record<string, any> = {
      baseDailyLevel: avgDailySales,
      promotionActive,
    };
    let factors: any[] = [];
    let dailyBreakdown: Array<{ date: string; predictedQuantity: number }> = [];

    if (aiResponse) {
      // AI success path
      modelVersionId = aiResponse.modelVersionId || modelVersionId;
      predictedOrders = Math.max(
        0,
        Math.round(aiResponse.predictedOrders || 0),
      );
      confidence = aiResponse.confidence || ConfidenceLevelEnum.MEDIUM;
      source = PredictionSourceEnum.AI_MODEL;
      featuresUsed = aiResponse.featuresUsed || featuresUsed;
      factors = aiResponse.factors || [];

      const rawBreakdown = Array.isArray(aiResponse.dailyBreakdown)
        ? aiResponse.dailyBreakdown
        : [];

      if (rawBreakdown.length > 0 && rawBreakdown.length !== 7) {
        this.logger.warn(
          `AI dailyBreakdown had ${rawBreakdown.length} rows (expected 7) for product ${productId.toString()}; treating as unusable and falling back to even distribution.`,
        );
      }

      if (rawBreakdown.length === 7) {
        // `predictedQuantity` is the contract. The `qty` fallback is a
        // transitional alias for older builds of the AI service; when it is the
        // only key present we log, because it means the two sides have drifted.
        let usedLegacyKey = false;
        dailyBreakdown = rawBreakdown.map((item: any, idx: number) => {
          let raw = item?.predictedQuantity;
          if (raw === undefined || raw === null) {
            raw = item?.qty;
            if (raw !== undefined && raw !== null) usedLegacyKey = true;
          }
          const parsed = Number(raw);
          return {
            date: item?.date || dailyDates[idx] || targetWeekStr,
            predictedQuantity: Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0,
          };
        });

        if (usedLegacyKey) {
          this.logger.warn(
            `AI dailyBreakdown used the deprecated 'qty' key for product ${productId.toString()}. Upgrade the AI service.`,
          );
        }

        // The weekly total is authoritative only if it reconciles with the days.
        // The bridge sums rounded dailies, so a mismatch means a real drift.
        const breakdownSum = dailyBreakdown.reduce(
          (acc, d) => acc + d.predictedQuantity,
          0,
        );
        if (breakdownSum !== predictedOrders) {
          this.logger.warn(
            `dailyBreakdown sum (${breakdownSum}) != predictedOrders (${predictedOrders}) for product ${productId.toString()}; trusting the daily rows.`,
          );
          predictedOrders = breakdownSum;
        }
      } else {
        dailyBreakdown = this.distributeAcrossWeek(predictedOrders, dailyDates);
      }
    } else {
      // REQUIREMENT 6: AI failure fallback path
      this.logger.error(
        `[FALLBACK PREDICTION] AI prediction call failed${
          aiResult.ok ? '' : `: ${aiResult.message}`
        } for product ${productId.toString()} on targetWeek ${targetWeekStr}. Using naive fallback.`,
      );

      // Fallback: equivalent period from last week (7 days prior)
      const lastWeekStart = new Date(`${targetWeekStr}T00:00:00.000Z`);
      lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);
      const lastWeekEnd = new Date(`${targetWeekStr}T00:00:00.000Z`);

      const lastWeekSales = await this.salesTransactionRepository.findMany({
        filters: {
          restaurantId,
          productId,
          isDeleted: false,
          date: { $gte: lastWeekStart, $lt: lastWeekEnd },
        },
      });

      const totalLastWeekQty = (lastWeekSales || []).reduce(
        (sum, s) => sum + (s.quantitySold || 0),
        0,
      );

      predictedOrders =
        totalLastWeekQty > 0
          ? totalLastWeekQty
          : Math.round(avgDailySales * 7);

      modelVersionId = 'fallback-naive-v1';
      confidence = ConfidenceLevelEnum.LOW;
      source = PredictionSourceEnum.FALLBACK_NAIVE;
      featuresUsed = {
        fallbackReason: 'AI service unreachable',
        lastWeekQty: totalLastWeekQty,
        avgDailySales,
      };

      dailyBreakdown = this.distributeAcrossWeek(predictedOrders, dailyDates);
    }

    // Upsert into prediction collection (Requirement 8: Idempotency)
    const existing = await this.predictionModel.findOne({
      restaurantId,
      productId,
      targetWeek: targetWeekStr,
    });

    let savedPrediction: PredictionType;

    if (existing) {
      existing.modelVersionId = modelVersionId;
      existing.predictedOrders = predictedOrders;
      existing.confidence = confidence;
      existing.source = source;
      existing.featuresUsed = featuresUsed;
      existing.factors = factors;
      existing.dailyBreakdown = dailyBreakdown;
      existing.isDeleted = false;
      savedPrediction = await existing.save();
    } else {
      savedPrediction = await this.predictionModel.create({
        restaurantId,
        productId,
        modelVersionId,
        targetWeek: targetWeekStr,
        predictedOrders,
        confidence,
        source,
        featuresUsed,
        factors,
        dailyBreakdown,
        isDeleted: false,
      });
    }

    return savedPrediction;
  }

  /**
   * Recalculate single product endpoint handler
   */
  async recalculateSingle(
    userId: string,
    productIdStr: string,
    targetWeekInput?: string,
  ) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    this.validateObjectId(productIdStr);
    const productId = new Types.ObjectId(productIdStr);
    const targetWeek = this.resolveTargetWeek(targetWeekInput);

    const prediction = await this.recalculateProductPrediction(
      restaurantId,
      productId,
      targetWeek,
    );

    return { data: prediction };
  }

  /**
   * Batch recalculate for all active products in restaurant
   */
  async batchRecalculate(userId: string, targetWeekInput?: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const userObjectId = new Types.ObjectId(userId);
    const targetWeek = this.resolveTargetWeek(targetWeekInput);

    const activeProducts = await this.productRepository.findMany({
      filters: { restaurantId, isDeleted: false },
    });

    const predictions: PredictionType[] = [];

    for (const prod of activeProducts || []) {
      try {
        const pred = await this.recalculateProductPrediction(
          restaurantId,
          prod._id,
          targetWeek,
        );
        predictions.push(pred);
      } catch (err: any) {
        this.logger.error(
          `Failed to recalculate prediction for product ${prod._id.toString()}: ${err?.message}`,
        );
      }
    }

    // Automatically trigger SupplierAutoDraftService workflow
    const autoDraftResult =
      await this.supplierAutoDraftService.generateAutoDrafts(
        restaurantId,
        targetWeek,
        userObjectId,
      );

    return {
      targetWeek,
      totalProductsPredicted: predictions.length,
      predictions,
      autoDraftPOsCreated: autoDraftResult.draftPurchaseOrders.length,
      draftPurchaseOrders: autoDraftResult.draftPurchaseOrders,
      unassignedShortfalls: autoDraftResult.unassignedShortfalls,
    };
  }

  /**
   * Query stored predictions
   */
  async getPredictions(query: QueryPredictionsDto, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const { page = '1', limit = '10', targetWeek, productId } = query;

    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);
    const pageNum = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const limitNum =
      Number.isNaN(parsedLimit) || parsedLimit < 1 ? 10 : parsedLimit;
    const skip = (pageNum - 1) * limitNum;

    const filters: Record<string, any> = {
      restaurantId,
      isDeleted: false,
    };

    if (targetWeek) {
      filters.targetWeek = targetWeek;
    }

    if (productId) {
      this.validateObjectId(productId);
      filters.productId = new Types.ObjectId(productId);
    }

    const result = await this.predictionRepository.findManyPaginated({
      filters,
      skip,
      limit: limitNum,
      sort: 'createdAt',
      order: 'desc',
      populationArray: [{ path: 'productId' }] as any,
    });

    return result;
  }

  /**
   * Per-product training status, sourced from the MODEL.
   *
   * The previous local heuristic (`salesCount >= 30` transactions) had no
   * relationship to the model's real criterion — 14 quiet days with a learned
   * level — so the UI reported "trained" for products still forecast from the
   * bridge's DEFAULT_DAILY_LEVEL. When the AI is unreachable we still answer,
   * but say so via `degraded`.
   */
  async getLearnedStatus(userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);

    const activeProducts =
      (await this.productRepository.findMany({
        filters: { restaurantId, isDeleted: false },
        populationArray: [{ path: 'category' }],
      })) || [];

    const aiStatus = await this.aiClient.get<any>(
      `/integration/restomind/status/${restaurantId.toString()}`,
      { retries: 2, timeoutMs: 5000 },
    );

    const byProductId = new Map<string, any>();
    if (aiStatus.ok) {
      for (const item of aiStatus.data?.items || []) {
        byProductId.set(String(item.productId), item);
      }
    }

    const items: any[] = [];

    for (const prod of activeProducts) {
      const pid = prod._id.toString();

      const salesRecordsCount =
        await this.salesTransactionRepository.countDocuments({
          restaurantId,
          productId: prod._id,
          isDeleted: false,
        });

      const predictions = await this.predictionRepository.findMany({
        filters: { restaurantId, productId: prod._id, isDeleted: false },
        sort: { targetWeek: -1 },
      });
      const latest = predictions?.length ? predictions[0] : null;

      const modelItem = byProductId.get(pid);
      const observedDays = modelItem?.observedDays ?? 0;
      const levelSource: 'learned_from_sales' | 'owner_estimate' =
        modelItem?.levelSource === 'learned_from_sales'
          ? 'learned_from_sales'
          : 'owner_estimate';

      const status =
        levelSource === 'learned_from_sales'
          ? 'trained'
          : observedDays > 0 || salesRecordsCount > 0
            ? 'learning'
            : 'cold_start';

      items.push({
        productId: prod._id,
        title: prod.title,
        salesRecordsCount,
        observedDays,
        levelSource,
        learnedLevel: modelItem?.learnedLevel ?? null,
        status,
        progress:
          Math.round(Math.min(1, observedDays / MIN_DAYS_FOR_LEARNED) * 1000) /
          1000,
        latestModelVersion: latest ? latest.modelVersionId : 'none',
        latestPredictionSource: latest ? latest.source : 'none',
        lastUpdated: latest ? (latest as any).updatedAt : null,
      });
    }

    return {
      restaurantId,
      totalProducts: items.length,
      trainedCount: items.filter((i) => i.status === 'trained').length,
      degraded: !aiStatus.ok,
      ...(aiStatus.ok ? {} : { degradedReason: aiStatus.message }),
      items,
    };
  }

  /**
   * Ship the restaurant's recent sales history to the AI in one call so learned
   * demand levels bootstrap immediately.
   *
   * Without this, the only feed is the nightly one-day sync, and the model needs
   * ~14 quiet weekdays before a product promotes off the owner's estimate — so a
   * restaurant with two years of history would still wait a month. The bridge
   * de-duplicates on (date, productId), so this is safe to re-run.
   */
  async backfillAiHistory(userId: string, days = 120) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const today = getBusinessDateString();
    const fromDateStr = addDaysToDateString(today, -Math.abs(days));
    // Cairo day boundary, not the UTC-aligned instant of the same date
    // string — otherwise the window's lower bound silently excludes the
    // first few early-morning hours (Cairo time) of the oldest day.
    const fromDate = getBusinessDayRange(fromDateStr).start;

    const products =
      (await this.productRepository.findMany({
        filters: { restaurantId, isDeleted: false },
        populationArray: [{ path: 'category' }],
      })) || [];

    const sales =
      (await this.salesTransactionRepository.findMany({
        filters: {
          restaurantId,
          isDeleted: false,
          date: { $gte: fromDate },
        },
      })) || [];

    if (sales.length === 0) {
      return {
        restaurantId: restaurantId.toString(),
        daysRequested: days,
        rowsSent: 0,
        productsSent: 0,
        learnedLevels: {},
      };
    }

    const records = sales.map((s: any) => ({
      // Must match the nightly sync's key derivation
      // (production-planning.service.ts's handleNightlyAiSync): both feed the
      // same AI registry, which de-duplicates on (date, productId) and groups
      // by date. A UTC-derived key here would disagree with the nightly
      // sync's Cairo-derived key for late-evening Cairo sales, causing dedup
      // misses and misattributed weekday averages.
      date: getBusinessDateString(new Date(s.date)),
      productId: s.productId.toString(),
      salesQty: s.quantitySold || 0,
    }));

    const productPayload = products.map((p: any) => ({
      productId: p._id.toString(),
      title: p.title || 'Product',
      category:
        p.category && typeof p.category === 'object' && p.category.name
          ? p.category.name
          : null,
      price: p.price || 0,
      freshnessWindow: p.freshnessWindow ?? null,
    }));

    const result = await this.aiClient.post<any>(
      '/integration/restomind/ingest',
      {
        restaurantId: restaurantId.toString(),
        records,
        products: productPayload,
      },
      { timeoutMs: 60_000 },
    );

    if (!result.ok) {
      this.logger.error(
        `AI backfill failed for restaurant ${restaurantId.toString()}: ${result.message}`,
      );
      throw new ServiceUnavailableException(
        `AI backfill failed: ${result.message}`,
      );
    }

    return {
      restaurantId: restaurantId.toString(),
      daysRequested: days,
      rowsSent: records.length,
      productsSent: productPayload.length,
      learnedLevels: result.data?.learnedLevels ?? {},
    };
  }

  /**
   * Automated Sunday 12:00 AM Cron Job for all active restaurants
   */
  @Cron('0 0 * * 0', { timeZone: BUSINESS_TIMEZONE })
  async handleWeeklyPredictionCron() {
    this.logger.log('Starting automated Weekly Demand Prediction Cron Job...');

    try {
      const restaurants = await this.restaurantRepository.findMany({
        filters: { isDeleted: false },
      });

      const targetWeek = this.resolveTargetWeek();

      for (const rest of restaurants || []) {
        const ownerUserId = rest.ownerUserId;
        if (!ownerUserId) continue;

        try {
          await this.batchRecalculate(ownerUserId.toString(), targetWeek);
        } catch (err: any) {
          this.logger.error(
            `Cron weekly prediction failed for restaurant ${rest._id.toString()}: ${err?.message}`,
          );
        }
      }

      this.logger.log('Weekly Demand Prediction Cron Job completed.');
    } catch (error: any) {
      this.logger.error(
        `Error running Weekly Demand Prediction Cron Job: ${error?.message}`,
      );
    }
  }
}
