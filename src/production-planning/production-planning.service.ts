import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { ConfidenceLevelEnum, ProductionPlanSourceEnum } from '../Common/Types';
import {
  BUSINESS_TIMEZONE,
  addDaysToDateString,
  getBusinessDateString,
  getBusinessDayRange,
} from '../Common/Utils/date.util';
import { resolveDailySalesEstimate } from '../Common/Utils/sales-estimate.util';
import {
  degradationFields,
  reportAiFailure,
} from '../Common/Utils/ai-degradation.util';
import type { AiDegradation } from '../Common/Types/ai.types';
import {
  DailyProductionPlan,
  DailyProductionPlanType,
} from '../DB/Models/daily-production-plan.model';
import { DailyProductionPlanRepository } from '../DB/Repositories/daily-production-plan.repository';
import { ProductRepository } from '../DB/Repositories/product.repository';
import { SalesTransactionRepository } from '../DB/Repositories/sales-transaction.repository';
import { UserRepository } from '../DB/Repositories/user.repository';
import { RestaurantRepository } from '../DB/Repositories/restaurant.repository';
import { AiIngestService } from '../imports/services/ai-ingest.service';
import { RecordActualsDto } from './dto/record-actuals.dto';
import { AiClientService } from '../Common/Services/ai-client.service';
import { ProductCostService } from '../Common/Services/product-cost.service';
import {
  buildAiProductPayload,
  buildAiProductPayloadsFor,
} from '../Common/Utils/ai-product.util';

export const AVG_DAILY_SALES_LOOKBACK_DAYS = 14;

export const PRODUCT_POPULATION_OPTIONS = [
  {
    path: 'items.productId',
    select: 'title price image category freshnessWindow',
    populate: {
      path: 'category',
      select: 'name',
    },
  },
];

@Injectable()
export class ProductionPlanningService {
  private readonly logger = new Logger(ProductionPlanningService.name);

  constructor(
    private readonly aiClient: AiClientService,
    private readonly dailyProductionPlanRepository: DailyProductionPlanRepository,
    private readonly productRepository: ProductRepository,
    private readonly salesTransactionRepository: SalesTransactionRepository,
    private readonly userRepository: UserRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly aiIngestService: AiIngestService,
    private readonly productCostService: ProductCostService,
    @InjectModel(DailyProductionPlan.name)
    private readonly dailyProductionPlanModel: Model<DailyProductionPlanType>,
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
   * Helper to get today's date in YYYY-MM-DD format
   */
  getTodayDateString(): string {
    return getBusinessDateString();
  }

  /**
   * Helper to get previous date string for YYYY-MM-DD
   */
  getYesterdayDateString(dateStr: string): string {
    return addDaysToDateString(dateStr, -1);
  }

  /**
   * GET /predictions/production-plan?date=YYYY-MM-DD
   * Populates item product details (title, category, image, price, freshnessWindow).
   */
  async getProductionPlan(userId: string, requestedDate?: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const todayStr = this.getTodayDateString();
    const dateStr = requestedDate || todayStr;
    let degradation: AiDegradation | null = null;

    // Browsing to an arbitrary future date would generate AND persist a plan,
    // hammering the AI once per page view.
    const MAX_HORIZON_DAYS = 14;
    if (dateStr > addDaysToDateString(todayStr, MAX_HORIZON_DAYS)) {
      throw new BadRequestException(
        `Production plans can only be generated up to ${MAX_HORIZON_DAYS} days ahead`,
      );
    }

    // Check if plan exists (populated)
    let plan = await this.dailyProductionPlanRepository.findOne({
      filters: { restaurantId, date: dateStr, isDeleted: false },
      populationArray: PRODUCT_POPULATION_OPTIONS,
    });

    if (!plan) {
      // If date is in the past and no plan exists -> 404
      if (dateStr < todayStr) {
        throw new NotFoundException(
          `No production plan exists for past date: ${dateStr}`,
        );
      }

      // If date is today or future -> generate on-demand
      await this.generateProductionPlan(restaurantId, dateStr, (d) => {
        degradation = d;
      });

      // Re-fetch populated plan
      plan = await this.dailyProductionPlanRepository.findOne({
        filters: { restaurantId, date: dateStr, isDeleted: false },
        populationArray: PRODUCT_POPULATION_OPTIONS,
      });
    }

    // A plan read straight from the DB carries no live failure, but its rows
    // still remember whether the AI produced them — so a cached fallback plan
    // is reported as degraded too, rather than reading as a healthy forecast.
    const fellBack = (plan?.items || []).some(
      (i: any) => i.source === ProductionPlanSourceEnum.FALLBACK_YESTERDAY,
    );

    if (!degradation && fellBack) {
      return {
        success: true,
        data: plan,
        degraded: true,
        degradedReason:
          'Plan was produced by the local fallback policy, not the forecasting model',
      };
    }

    return { success: true, data: plan, ...degradationFields(degradation) };
  }

  /**
   * POST /predictions/production-plan/actuals
   * Updates actualProducedQty for specified products using atomic arrayFilters
   */
  async recordActuals(userId: string, dto: RecordActualsDto) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const targetDate = dto.date || this.getTodayDateString();

    const plan = await this.dailyProductionPlanRepository.findOne({
      filters: { restaurantId, date: targetDate, isDeleted: false },
    });

    if (!plan) {
      throw new NotFoundException(
        `Production plan for date ${targetDate} not found`,
      );
    }

    // Validate all productIds
    for (const item of dto.items) {
      if (!Types.ObjectId.isValid(item.productId)) {
        throw new BadRequestException(`Invalid productId: ${item.productId}`);
      }
    }

    // arrayFilters silently match nothing for a product that is not in the
    // plan, so the manager saw success while their entry vanished. Partition
    // up front and report both halves.
    const planProductIds = new Set(
      (plan.items || []).map((i: any) =>
        (i.productId?._id ?? i.productId).toString(),
      ),
    );
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const item of dto.items) {
      (planProductIds.has(item.productId) ? applied : skipped).push(
        item.productId,
      );
    }

    // Build atomic $set and arrayFilters
    const setQuery: Record<string, any> = {};
    const arrayFilters: Record<string, any>[] = [];

    dto.items
      .filter((item) => planProductIds.has(item.productId))
      .forEach((item, index) => {
        const filterKey = `elem${index}`;
        setQuery[`items.$[${filterKey}].actualProducedQty`] =
          item.actualProducedQty;
        arrayFilters.push({
          [`${filterKey}.productId`]: new Types.ObjectId(item.productId),
        });
      });

    if (Object.keys(setQuery).length > 0) {
      await this.dailyProductionPlanModel
        .findOneAndUpdate(
          { _id: plan._id },
          { $set: setQuery },
          { arrayFilters, new: true },
        )
        .exec();
    }

    // Return populated plan freshly fetched from DB
    const populatedPlan = await this.dailyProductionPlanRepository.findOne({
      filters: { _id: plan._id },
      populationArray: PRODUCT_POPULATION_OPTIONS,
    });

    return { success: true, data: populatedPlan, applied, skipped };
  }

  /**
   * Core Generation Logic for Daily Production Plan
   */
  async generateProductionPlan(
    restaurantId: Types.ObjectId,
    dateStr: string,
    // Optional sink so the HTTP caller can report WHY the plan it just got is
    // a fallback. A callback rather than a changed return type, so the cron
    // and every existing caller stay untouched.
    onAiFailure?: (degradation: AiDegradation) => void,
  ): Promise<DailyProductionPlanType> {
    // 1. Check duplicate plan
    const existing = await this.dailyProductionPlanRepository.findOne({
      filters: { restaurantId, date: dateStr, isDeleted: false },
    });
    if (existing) {
      return existing;
    }

    // 2. Fetch active products
    const products =
      (await this.productRepository.findMany({
        filters: { restaurantId, isDeleted: false },
        populationArray: [{ path: 'category' }],
      })) || [];

    if (products.length === 0) {
      const emptyPlan = await this.dailyProductionPlanRepository.create({
        restaurantId,
        date: dateStr,
        totalRecommendedQty: 0,
        items: [],
      });
      return emptyPlan;
    }

    // 3. Compute 14-day avgDailySales per product.
    // `new Date(`${dateStr}T00:00:00.000Z`)` was a UTC-midnight literal built
    // from a *Cairo* date string, so the whole lookback sat 2–3h off the Cairo
    // days it claimed to cover — crediting the small hours of the plan day to
    // the window and dropping the same slice 14 days back. Same defect class as
    // the reconciliation window; use the Cairo day helper.
    const cutoffDate = getBusinessDayRange(dateStr).start;
    const startDate = getBusinessDayRange(
      addDaysToDateString(dateStr, -AVG_DAILY_SALES_LOOKBACK_DAYS),
    ).start;

    const salesList =
      (await this.salesTransactionRepository.findMany({
        filters: {
          restaurantId,
          date: { $gte: startDate, $lt: cutoffDate },
          isDeleted: false,
        },
      })) || [];

    // Sum sales per product, and separately track how many sales rows each
    // product has — resolveDailySalesEstimate needs the row count (not just the
    // total) to tell "measured zero" apart from "no history at all".
    const salesMap = new Map<string, number>();
    const salesRowCountMap = new Map<string, number>();
    for (const sale of salesList) {
      const pId = sale.productId ? sale.productId.toString() : '';
      if (pId) {
        const currentSum = salesMap.get(pId) || 0;
        salesMap.set(pId, currentSum + (sale.quantitySold || 0));
        salesRowCountMap.set(pId, (salesRowCountMap.get(pId) || 0) + 1);
      }
    }

    // Real unit_cost lets the AI service pick a profit-optimal recommendedQty
    // within its uncertainty band instead of always the raw point estimate —
    // see the model's `_newsvendor_quantile`. `null` (unknown recipe/cost)
    // keeps its old behaviour exactly.
    const unitCosts = await this.productCostService.getUnitCosts(
      restaurantId,
      products.map((p: any) => p._id),
    );

    const preparedProducts = products.map((prod: any) => {
      const pIdStr = prod._id.toString();
      const totalSold = salesMap.get(pIdStr) || 0;
      const salesRowCount = salesRowCountMap.get(pIdStr) || 0;
      // Precedence: measured 14-day history > owner's expectedDailySales
      // estimate > null (cold start, no signal at all). Sending 0 for a
      // brand-new product with no history would forecast zero and make
      // supplier-auto-draft skip it entirely.
      const estimate = resolveDailySalesEstimate(
        totalSold,
        salesRowCount,
        prod,
        dateStr,
      );

      // The shared shape plus the estimate this endpoint alone supplies.
      // `freshnessWindow` was defaulted to 2 here; the plan endpoint never
      // reads it (only the surplus scan does, for spoilage severity), so the
      // helper's honest `null` changes nothing but stops a made-up shelf life
      // being recorded against the product.
      //
      // The window rides along whenever the figure is a measured mean. The AI
      // multiplies what we send by the target day's calendar multiplier, so it
      // has to know the figure already carries a window's worth of calendar —
      // otherwise a lookback sitting inside Ramadan gets Ramadan applied twice.
      return {
        ...buildAiProductPayload(prod, unitCosts.get(pIdStr) ?? null),
        avgDailySales: estimate.value,
        ...(estimate.window ? { avgDailySalesWindow: estimate.window } : {}),
      };
    });

    // 4. Call the AI microservice through the shared client.
    const aiResult = await this.aiClient.post<any>(
      '/integration/restomind/production-plan',
      {
        restaurantId: restaurantId.toString(),
        date: dateStr,
        products: preparedProducts,
      },
    );

    const aiResponse =
      aiResult.ok && aiResult.data?.items ? aiResult.data : null;

    const planItems: any[] = [];
    let totalRecommendedQty = 0;

    if (aiResponse && aiResponse.items) {
      // AI success path
      for (const item of aiResponse.items) {
        const recQty = Math.max(0, Math.round(item.recommendedQty || 0));
        totalRecommendedQty += recQty;
        planItems.push({
          productId: new Types.ObjectId(item.productId),
          recommendedQty: recQty,
          lowerBound: item.lowerBound ?? Math.round(recQty * 0.8),
          upperBound: item.upperBound ?? Math.round(recQty * 1.2),
          confidence: item.confidence || ConfidenceLevelEnum.MEDIUM,
          source: ProductionPlanSourceEnum.AI_MODEL,
          factors: item.factors || [],
          actualProducedQty: null,
        });
      }
    } else {
      // AI failure -> Fallback handling.
      // Branching on `ok` alone logged a never-retried 401 with the same
      // "unreachable" wording as a genuine outage, so a missing
      // AI_SHARED_SECRET produced a whole restaurant of FALLBACK_YESTERDAY
      // plans that looked like a transient blip. Classify by KIND.
      if (!aiResult.ok) {
        onAiFailure?.(
          reportAiFailure(
            this.logger,
            '/integration/restomind/production-plan',
            aiResult,
            `restaurant ${restaurantId.toString()}, date ${dateStr}`,
          ),
        );
      }

      this.logger.error(
        `[CRITICAL ALERT] AI Production Plan generation failed${
          aiResult.ok ? '' : `: ${aiResult.message}`
        } for restaurant ${restaurantId} on date ${dateStr}. Triggering fallback policy.`,
      );

      const yesterdayStr = this.getYesterdayDateString(dateStr);
      const yesterdayPlan = await this.dailyProductionPlanRepository.findOne({
        filters: { restaurantId, date: yesterdayStr, isDeleted: false },
      });

      const yesterdayMap = new Map<string, number>();
      if (yesterdayPlan && yesterdayPlan.items) {
        for (const item of yesterdayPlan.items) {
          const pId = item.productId._id || item.productId;
          yesterdayMap.set(pId.toString(), item.recommendedQty || 0);
        }
      }

      for (const prepProd of preparedProducts) {
        let recQty = 0;
        let factor = '';

        if (yesterdayPlan && yesterdayMap.has(prepProd.productId)) {
          recQty = yesterdayMap.get(prepProd.productId) || 0;
          factor = 'fallback_yesterday_plan';
        } else {
          // prepProd.avgDailySales is null only when there is truly no
          // signal — no measured history AND no owner estimate — in which
          // case 0 is the honest local answer; resolveDailySalesEstimate already
          // surfaced the owner's expectedDailySales above whenever one was
          // set, so this `?? 0` never discards a real estimate.
          recQty = prepProd.avgDailySales ?? 0;
          factor = 'fallback_14day_avg_daily_sales';
        }

        recQty = Math.max(0, Math.round(recQty));
        totalRecommendedQty += recQty;

        planItems.push({
          productId: new Types.ObjectId(prepProd.productId),
          recommendedQty: recQty,
          lowerBound: Math.round(recQty * 0.8),
          upperBound: Math.round(recQty * 1.2),
          confidence: ConfidenceLevelEnum.LOW,
          source: ProductionPlanSourceEnum.FALLBACK_YESTERDAY,
          factors: [factor],
          actualProducedQty: null,
        });
      }
    }

    // 5. Persist plan with unique compound index handling
    try {
      const created = await this.dailyProductionPlanRepository.create({
        restaurantId,
        date: dateStr,
        totalRecommendedQty,
        items: planItems,
      });
      return created;
    } catch (err: any) {
      if (err?.code === 11000) {
        // Compound index duplicate key error
        const existing = await this.dailyProductionPlanRepository.findOne({
          filters: { restaurantId, date: dateStr, isDeleted: false },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  /**
   * Cron Job 1: Daily Production Plan Generation — 01:00 Cairo.
   *
   * Was EVERY_DAY_AT_MIDNIGHT (`0 0 * * *`), which collided with
   * WeeklyPredictionService's `0 0 * * 0` in the same minute every Sunday.
   * The FastAPI service is single-process and the batch retry budget is only
   * 2 attempts at a 10s timeout, so the contention pushed products onto the
   * naive fallback on exactly one night a week. The schedule is now:
   *   01:00 daily — this plan sync
   *   02:00 daily — nightly AI learning sync
   *   00:00 Sunday — weekly prediction batch
   *   03:00 Sunday — accuracy reconciliation
   * Written as an explicit expression rather than CronExpression so the hour
   * is visible next to the timezone it is interpreted in.
   */
  @Cron('0 1 * * *', { timeZone: BUSINESS_TIMEZONE })
  async handleDailyPlanGeneration() {
    this.logger.log('Executing 01:00 daily production plan generation cron...');
    const todayStr = this.getTodayDateString();

    const restaurants =
      (await this.restaurantRepository.findMany({
        filters: { isDeleted: false },
      })) || [];

    for (const rest of restaurants) {
      try {
        await this.generateProductionPlan(
          new Types.ObjectId(rest._id.toString()),
          todayStr,
        );
      } catch (err: any) {
        this.logger.error(
          `Failed generating daily production plan for restaurant ${rest._id}: ${err?.message || err}`,
        );
      }
    }
  }

  /**
   * Cron Job 2: Nightly AI Learning Sync (2:00 AM)
   * Reuses Phase 4 AiIngestService directly!
   */
  @Cron('0 2 * * *', { timeZone: BUSINESS_TIMEZONE })
  async handleNightlyAiSync() {
    this.logger.log('Executing 2:00 AM nightly AI learning sync cron...');
    const todayStr = this.getTodayDateString();
    const yesterdayStr = this.getYesterdayDateString(todayStr);

    // `yesterdayStr` is a Cairo calendar date. Bound the query window with the
    // actual UTC instants of that Cairo day — interpolating it into a
    // `T00:00:00.000Z` boundary would make the window UTC-aligned but
    // Cairo-labelled, with a tail reaching into the current hour.
    const { start: yesterdayStart, end: yesterdayEnd } =
      getBusinessDayRange(yesterdayStr);

    const restaurants =
      (await this.restaurantRepository.findMany({
        filters: { isDeleted: false },
      })) || [];

    for (const rest of restaurants) {
      try {
        const restId = new Types.ObjectId(rest._id.toString());
        const sales =
          (await this.salesTransactionRepository.findMany({
            filters: {
              restaurantId: restId,
              date: { $gte: yesterdayStart, $lt: yesterdayEnd },
              isDeleted: false,
            },
          })) || [];

        if (sales.length === 0) {
          continue;
        }

        // Yesterday's own production plan, if one was generated -- gives real
        // productionQty per product instead of leaving it unsent every night.
        const yesterdayPlan = await this.dailyProductionPlanRepository.findOne(
          { filters: { restaurantId: restId, date: yesterdayStr, isDeleted: false } },
        );
        const productionByProductId = new Map<string, number>();
        for (const item of yesterdayPlan?.items || []) {
          if (item.actualProducedQty == null) continue;
          productionByProductId.set(
            item.productId.toString(),
            item.actualProducedQty,
          );
        }

        const records = sales.map((s: any) => {
          // Derive the key from the Cairo day the sale actually happened on —
          // `toISOString().split('T')[0]` would attribute a sale near Cairo
          // midnight to the previous UTC day.
          const date = s.date
            ? getBusinessDateString(new Date(s.date))
            : yesterdayStr;
          const productId = s.productId ? s.productId.toString() : '';
          const productionQty =
            s.productionQuantity ?? productionByProductId.get(productId);
          return {
            date,
            productId,
            salesQty: s.quantitySold || 0,
            ...(productionQty !== undefined ? { productionQty } : {}),
            // Real, already-recorded stockout signal -- see backfillAiHistory
            // in weekly-prediction.service.ts for the same reasoning.
            ...(s.stockoutMinutes > 0 ? { closingStock: 0 } : {}),
          };
        });

        // Sending `products: []` made the registry auto-register each product
        // with title=productId and category=None, so every product resolved to
        // neutral calendar priors. Send the real metadata.
        const products =
          (await this.productRepository.findMany({
            filters: { restaurantId: restId, isDeleted: false },
            populationArray: [{ path: 'category' }],
          })) || [];
        const unitCosts = await this.productCostService.getUnitCosts(
          restId,
          products.map((p: any) => p._id),
        );

        await this.aiIngestService.ingest({
          restaurantId: restId.toString(),
          records,
          products: buildAiProductPayloadsFor(
            products,
            records.map((r) => r.productId),
            unitCosts,
          ),
        });
      } catch (err: any) {
        this.logger.error(
          `Failed nightly AI learning sync for restaurant ${rest._id}: ${err?.message || err}`,
        );
      }
    }
  }
}
