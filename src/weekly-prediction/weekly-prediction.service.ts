import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
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

export const AVG_DAILY_SALES_LOOKBACK_DAYS = 14;

@Injectable()
export class WeeklyPredictionService {
  private readonly logger = new Logger(WeeklyPredictionService.name);

  constructor(
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

    // 3. Try AI microservice call with 3 retries & exponential backoff
    const aiBaseUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8200';
    const aiEndpoint = `${aiBaseUrl.replace(/\/$/, '')}/integration/restomind/predict`;

    let aiResponse: any = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(aiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            restaurantId: restaurantId.toString(),
            productId: productId.toString(),
            title: product.title,
            category: categoryName,
            targetWeek: targetWeekStr,
            avgDailySales,
            promotionActive,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const bodyData = await response.json();
          if (bodyData && bodyData.predictedOrders !== undefined) {
            aiResponse = bodyData;
            break;
          }
        } else {
          this.logger.warn(
            `AI predict attempt ${attempts}/${maxAttempts} returned HTTP ${response.status}`,
          );
        }
      } catch (err: any) {
        this.logger.warn(
          `AI predict attempt ${attempts}/${maxAttempts} failed: ${err?.message || err}`,
        );
      }

      if (attempts < maxAttempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * Math.pow(2, attempts - 1)),
        );
      }
    }

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
        `[FALLBACK PREDICTION] AI prediction call failed after ${maxAttempts} retries for product ${productId.toString()} on targetWeek ${targetWeekStr}. Using naive fallback.`,
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
   * Get AI learning status per product
   */
  async getLearnedStatus(userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);

    const activeProducts = await this.productRepository.findMany({
      filters: { restaurantId, isDeleted: false },
      populationArray: [{ path: 'category' }],
    });

    const statusList: any[] = [];

    for (const prod of activeProducts || []) {
      const salesCount = await this.salesTransactionRepository.countDocuments({
        restaurantId,
        productId: prod._id,
        isDeleted: false,
      });

      const predictions = await this.predictionRepository.findMany({
        filters: { restaurantId, productId: prod._id, isDeleted: false },
        sort: { createdAt: -1 },
      });

      const latestPrediction =
        predictions && predictions.length > 0 ? predictions[0] : null;

      const isTrained = salesCount >= 30; // 30+ transactions threshold
      const status = isTrained
        ? 'trained'
        : salesCount > 0
          ? 'learning'
          : 'cold_start';

      statusList.push({
        productId: prod._id,
        title: prod.title,
        salesRecordsCount: salesCount,
        status,
        latestModelVersion: latestPrediction
          ? latestPrediction.modelVersionId
          : 'none',
        latestPredictionSource: latestPrediction
          ? latestPrediction.source
          : 'none',
        lastUpdated: latestPrediction
          ? (latestPrediction as any).updatedAt
          : null,
      });
    }

    return {
      restaurantId,
      totalProducts: statusList.length,
      items: statusList,
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
