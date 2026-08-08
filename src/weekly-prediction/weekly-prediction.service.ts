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
import { resolveAvgDailySales } from 'src/Common/Utils/sales-estimate.util';
import { resolveCategoryName } from 'src/Common/Utils/ai-product.util';
import {
  degradationFields,
  reportAiFailure,
} from 'src/Common/Utils/ai-degradation.util';
import type { AiDegradation } from 'src/Common/Types/ai.types';
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

/**
 * Products recalculated in parallel. Sequential processing meant 50 products
 * could take 25 minutes in one request; unbounded parallelism would stampede
 * the single-process AI service.
 */
export const BATCH_CONCURRENCY = 5;

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
    // Cairo week bounds: `targetWeekStr` is a Cairo calendar date, so a
    // UTC-midnight literal named an instant 2-3h away from the day it claims.
    const targetWeekStart = getBusinessDayRange(targetWeekStr).start;
    const targetWeekEnd = getBusinessDayRange(
      addDaysToDateString(targetWeekStr, 7),
    ).start;

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
    // Full budget by default: this function is shared, and recalculateSingle
    // (exactly one AI call per request) never had the "retries multiply by
    // catalogue size" problem that motivates the batch caller's reduced
    // budget below. Only pass a lower value from a caller that fans out.
    retries = 3,
    // Optional sink so a fan-out caller (batchRecalculate) can surface WHY the
    // rows it returns are fallbacks. Passed as a callback rather than folded
    // into the return value so the single-product signature — and every
    // existing caller and test double — stays untouched.
    onAiFailure?: (degradation: AiDegradation) => void,
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
    // Precedence: measured 14-day history > owner's expectedDailySales estimate
    // > null (cold start, no signal at all — let the bridge's category default
    // decide). Sending 0 here for a brand-new product with no history would
    // forecast zero all week and make supplier-auto-draft skip it entirely.
    const avgDailySales = resolveAvgDailySales(
      totalQtySold,
      (recentSales || []).length,
      product,
    );

    // 2. Check promotionActive from Offer collection (Requirement 7)
    const promotionActive = await this.checkPromotionActive(
      restaurantId,
      productId,
      targetWeekStr,
    );

    const categoryName = resolveCategoryName(product.category);

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
      { retries },
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
    // Recorded onto featuresUsed so a stored fallback row says WHY it is one.
    let fallbackReason = 'AI response missing predictedOrders';

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
            predictedQuantity: Number.isFinite(parsed)
              ? Math.max(0, Math.round(parsed))
              : 0,
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
      // REQUIREMENT 6: AI failure fallback path.
      // Branching on `ok` alone made a 401 (never retried, a configuration
      // fault) indistinguishable from a real outage. Classify by KIND, log
      // accordingly, and hand the descriptor up so the endpoint can report it.
      if (!aiResult.ok) {
        const degradation = reportAiFailure(
          this.logger,
          '/integration/restomind/predict',
          aiResult,
          `product ${productId.toString()}, targetWeek ${targetWeekStr}`,
        );
        onAiFailure?.(degradation);
        fallbackReason =
          degradation.kind === 'client_error'
            ? `AI rejected the request (HTTP ${degradation.status ?? '4xx'}) — probable configuration fault`
            : 'AI service unreachable';
      } else {
        this.logger.error(
          `[AI CONTRACT] AI answered ${'/integration/restomind/predict'} without a predictedOrders field for product ${productId.toString()} on targetWeek ${targetWeekStr}. Using naive fallback.`,
        );
        // A 200 that violates the contract is still a degraded answer. Without
        // this the row was persisted with featuresUsed.fallbackReason set while
        // the response said `degraded: false` — the same silent-200 failure F1
        // exists to close, reached through a different door.
        //
        // `unavailable`, not `client_error`: the request was fine, so blaming
        // the caller would be wrong, and this file's own type doc defines
        // `unavailable` as "the service could not answer, which is exactly when
        // a fallback is correct" — which is what happened. It also matches the
        // degradation scanSurplus synthesises for the identical shape (a 200
        // with no `itemsAtRisk`). Introducing a third `contract` kind is the
        // better long-term answer, but that is the classification question
        // deferred to the ledger, and taking it unilaterally here would leave
        // scanSurplus inconsistent.
        onAiFailure?.({ kind: 'unavailable', reason: fallbackReason });
      }

      this.logger.error(
        `[FALLBACK PREDICTION] AI prediction call failed${
          aiResult.ok ? '' : `: ${aiResult.message}`
        } for product ${productId.toString()} on targetWeek ${targetWeekStr}. Using naive fallback.`,
      );

      // Fallback: equivalent period from last week (7 days prior).
      // `targetWeekStr` comes from resolveTargetWeek, which returns a CAIRO
      // calendar date — so a UTC-midnight literal built from it was 2-3h off
      // the Cairo week it names. This arithmetic produces predictedOrders for
      // exactly the fallback rows the endpoint now labels as degraded; the
      // label was right while the number under it was three hours skewed.
      const lastWeekStart = getBusinessDayRange(
        addDaysToDateString(targetWeekStr, -7),
      ).start;
      const lastWeekEnd = getBusinessDayRange(targetWeekStr).start;

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

      // avgDailySales is null only when there is truly no signal anywhere —
      // no measured history AND no owner estimate. In that specific case 0 is
      // the honest naive-fallback answer (there is nothing else to go on
      // locally); it is not the bug this task fixes, because that bug was 0
      // being sent even when an owner estimate DID exist. As long as
      // resolveAvgDailySales already surfaced the owner's estimate above, this
      // `?? 0` only ever fires on the genuinely-uninformed path.
      predictedOrders =
        totalLastWeekQty > 0
          ? totalLastWeekQty
          : Math.round((avgDailySales ?? 0) * 7);

      modelVersionId = 'fallback-naive-v1';
      confidence = ConfidenceLevelEnum.LOW;
      source = PredictionSourceEnum.FALLBACK_NAIVE;
      featuresUsed = {
        fallbackReason,
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

    // Same reasoning as batchRecalculate: without this, a 401 storm answers
    // HTTP 200 with a fallback_naive row and tells the caller nothing. The
    // degradation must ride out on the response, not just the server log.
    let degradation: AiDegradation | null = null;

    const prediction = await this.recalculateProductPrediction(
      restaurantId,
      productId,
      targetWeek,
      // Full 3-attempt budget: exactly one AI call per request here.
      3,
      (d) => {
        degradation = d;
      },
    );

    return { data: prediction, ...degradationFields(degradation) };
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

    const activeProductsList = activeProducts || [];

    // Index-keyed slots (not push) so the result preserves the original
    // product query order even though workers complete out of order.
    const predictionSlots: (PredictionType | undefined)[] = new Array(
      activeProductsList.length,
    );
    const failedProductIds: string[] = [];
    // A batch that answers HTTP 200 with `totalProductsPredicted: 50` while
    // every single row is a naive fallback is indistinguishable from a healthy
    // batch. Count the degraded products and keep the first failure's kind so
    // the response can say so — and so a 401 storm reads as "misconfigured",
    // not "the AI is down".
    const degradedProductIds: string[] = [];
    let firstDegradation: AiDegradation | null = null;
    let cursor = 0;

    const worker = async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= activeProductsList.length) return;
        const prod = activeProductsList[idx];
        try {
          predictionSlots[idx] = await this.recalculateProductPrediction(
            restaurantId,
            prod._id,
            targetWeek,
            // 2 attempts, not the default 3: this runs once per product in a
            // batch, so the retry budget multiplies by the catalogue size.
            2,
            (degradation) => {
              degradedProductIds.push(prod._id.toString());
              // client_error wins: a configuration fault is the more
              // actionable diagnosis and must not be masked by a stray
              // timeout on another product.
              if (
                !firstDegradation ||
                (firstDegradation.kind !== 'client_error' &&
                  degradation.kind === 'client_error')
              ) {
                firstDegradation = degradation;
              }
            },
          );
        } catch (err: any) {
          failedProductIds.push(prod._id.toString());
          this.logger.error(
            `Failed to recalculate prediction for product ${prod._id.toString()}: ${err?.message}`,
          );
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(BATCH_CONCURRENCY, activeProductsList.length || 1) },
        () => worker(),
      ),
    );

    const predictions = predictionSlots.filter(
      (p): p is PredictionType => p !== undefined,
    );

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
      failedProductIds,
      // Degradation sits alongside failedProductIds: those two are different
      // outcomes. A failed product produced no row at all; a degraded product
      // produced a row the AI had no part in.
      ...degradationFields(firstDegradation),
      degradedProductIds,
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
    const { page = 1, limit = 10, targetWeek, productId } = query;
    const pageNum = page;
    const limitNum = limit;
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
    let degradation: AiDegradation | null = null;
    if (aiStatus.ok) {
      for (const item of aiStatus.data?.items || []) {
        byProductId.set(String(item.productId), item);
      }
    } else {
      degradation = reportAiFailure(
        this.logger,
        `/integration/restomind/status/${restaurantId.toString()}`,
        aiStatus,
      );
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
      ...degradationFields(degradation),
      items,
    };
  }

  /**
   * Write real sales back onto a closed week's predictions.
   *
   * `actualOrders` and `errorAbs` were declared on the model and never written
   * by anything, so there was no accuracy signal at all — no MAPE, no drift
   * detection, and `confidence` meant nothing. This closes that loop.
   */
  async reconcilePredictionAccuracy(
    restaurantId: Types.ObjectId,
    targetWeek: string,
  ) {
    // CORRECTION (controller, pre-dispatch): the original draft of this brief
    // built the window from UTC midnight (`T00:00:00.000Z`), which contradicts
    // this plan's Global Constraint that all business days are Cairo days. In
    // summer Cairo is UTC+3, so a UTC window would have credited the first
    // three hours of Sunday's sales to the wrong week and dropped the last
    // three hours of Saturday's. Use the Cairo day range helper added in
    // Task 4 instead.
    const weekStart = getBusinessDayRange(targetWeek).start;
    const weekEnd = getBusinessDayRange(addDaysToDateString(targetWeek, 6)).end;

    const predictions =
      (await this.predictionRepository.findMany({
        filters: { restaurantId, targetWeek, isDeleted: false },
      })) || [];

    if (predictions.length === 0) {
      return { targetWeek, reconciled: 0, mape: null };
    }

    const sales =
      (await this.salesTransactionRepository.findMany({
        filters: {
          restaurantId,
          isDeleted: false,
          date: { $gte: weekStart, $lt: weekEnd },
        },
      })) || [];

    const actualByProduct = new Map<string, number>();
    for (const sale of sales) {
      const key = sale.productId?.toString();
      if (!key) continue;
      actualByProduct.set(
        key,
        (actualByProduct.get(key) || 0) + (sale.quantitySold || 0),
      );
    }

    const operations: any[] = [];
    const errorRatios: number[] = [];

    for (const pred of predictions) {
      const actual = actualByProduct.get(pred.productId.toString()) || 0;
      const errorAbs = Math.abs((pred.predictedOrders || 0) - actual);

      operations.push({
        updateOne: {
          filter: { _id: pred._id },
          update: { $set: { actualOrders: actual, errorAbs } },
        },
      });

      // Skip zero-prediction rows: a percentage error against 0 is undefined
      // and would poison the mean. If every row in the week has
      // predictedOrders === 0, errorRatios stays empty and mape below is
      // null, not NaN.
      if (pred.predictedOrders > 0) {
        errorRatios.push(errorAbs / pred.predictedOrders);
      }
    }

    await this.predictionRepository.bulkWrite(operations);

    const mape = errorRatios.length
      ? Math.round(
          (errorRatios.reduce((a, b) => a + b, 0) / errorRatios.length) * 10000,
        ) / 10000
      : null;

    this.logger.log(
      `Reconciled ${operations.length} predictions for week ${targetWeek} (MAPE ${mape ?? 'n/a'})`,
    );

    return { targetWeek, reconciled: operations.length, mape };
  }

  /**
   * Rolling accuracy history, for the dashboard's headline metric.
   *
   * Fetches every reconciled prediction across the whole window in a single
   * query (`targetWeek: { $in: [...] }`) and groups by week in memory,
   * rather than issuing one `findMany` per week — 1 round trip instead of
   * `weeks` (8 by default).
   *
   * `actualOrders: { $ne: null }` is what actually restricts this to
   * reconciled rows: the model declares `actualOrders` with `default: null`
   * (not omitted), so Mongoose sets it explicitly to `null` on every
   * unreconciled document, and it never has a chance to be simply absent.
   * Mongo's `{ $ne: null }` excludes both "field is null" and "field is
   * missing" documents, so this filter is correct either way.
   */
  async getAccuracy(userId: string, weeks = 8) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const today = getBusinessDateString();
    const dayOfWeek = getBusinessDayOfWeek();
    const currentWeekStart = addDaysToDateString(today, -dayOfWeek);

    const targetWeeks: string[] = [];
    for (let i = 1; i <= weeks; i++) {
      targetWeeks.push(addDaysToDateString(currentWeekStart, -7 * i));
    }

    const predictions =
      (await this.predictionRepository.findMany({
        filters: {
          restaurantId,
          targetWeek: { $in: targetWeeks },
          isDeleted: false,
          actualOrders: { $ne: null },
        },
      })) || [];

    const byWeek = new Map<string, PredictionType[]>();
    for (const pred of predictions) {
      const key = pred.targetWeek;
      if (!byWeek.has(key)) byWeek.set(key, []);
      byWeek.get(key)!.push(pred);
    }

    const results = targetWeeks.map((targetWeek) => {
      const weekPredictions = byWeek.get(targetWeek) || [];

      if (weekPredictions.length === 0) {
        return {
          targetWeek,
          predictions: 0,
          mape: null,
          totalPredicted: 0,
          totalActual: 0,
        };
      }

      const ratios = weekPredictions
        .filter((p) => (p.predictedOrders || 0) > 0)
        .map((p) => (p.errorAbs || 0) / p.predictedOrders);

      return {
        targetWeek,
        predictions: weekPredictions.length,
        mape: ratios.length
          ? Math.round(
              (ratios.reduce((a, b) => a + b, 0) / ratios.length) * 10000,
            ) / 10000
          : null,
        totalPredicted: weekPredictions.reduce(
          (a, p) => a + (p.predictedOrders || 0),
          0,
        ),
        totalActual: weekPredictions.reduce(
          (a, p) => a + (p.actualOrders || 0),
          0,
        ),
      };
    });

    return { restaurantId: restaurantId.toString(), weeks: results.reverse() };
  }

  /**
   * Sunday 03:00 Cairo — reconcile the week that closed this morning.
   * Deliberately after the 00:00 prediction cron so the two never contend.
   */
  @Cron('0 3 * * 0', { timeZone: BUSINESS_TIMEZONE })
  async handleAccuracyReconciliationCron() {
    this.logger.log('Starting weekly prediction accuracy reconciliation...');

    const today = getBusinessDateString();
    const dayOfWeek = getBusinessDayOfWeek();
    const currentWeekStart = addDaysToDateString(today, -dayOfWeek);
    const closedWeek = addDaysToDateString(currentWeekStart, -7);

    const restaurants =
      (await this.restaurantRepository.findMany({
        filters: { isDeleted: false },
      })) || [];

    for (const rest of restaurants) {
      try {
        await this.reconcilePredictionAccuracy(
          new Types.ObjectId(rest._id.toString()),
          closedWeek,
        );
      } catch (err: any) {
        this.logger.error(
          `Accuracy reconciliation failed for restaurant ${rest._id.toString()}: ${err?.message}`,
        );
      }
    }

    this.logger.log('Weekly prediction accuracy reconciliation completed.');
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
      category: resolveCategoryName(p.category),
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
