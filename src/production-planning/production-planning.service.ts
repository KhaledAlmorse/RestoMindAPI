import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfidenceLevelEnum, ProductionPlanSourceEnum } from '../Common/Types';
import {
  BUSINESS_TIMEZONE,
  addDaysToDateString,
  getBusinessDateString,
  getBusinessDayRange,
} from '../Common/Utils/date.util';
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

    // Check if plan exists (populated)
    let plan = await this.dailyProductionPlanRepository.findOne({
      filters: { restaurantId, date: dateStr, isDeleted: false },
      populationArray: PRODUCT_POPULATION_OPTIONS as any,
    });

    if (!plan) {
      // If date is in the past and no plan exists -> 404
      if (dateStr < todayStr) {
        throw new NotFoundException(
          `No production plan exists for past date: ${dateStr}`,
        );
      }

      // If date is today or future -> generate on-demand
      await this.generateProductionPlan(restaurantId, dateStr);

      // Re-fetch populated plan
      plan = await this.dailyProductionPlanRepository.findOne({
        filters: { restaurantId, date: dateStr, isDeleted: false },
        populationArray: PRODUCT_POPULATION_OPTIONS as any,
      });
    }

    return { success: true, data: plan };
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

    // Build atomic $set and arrayFilters
    const setQuery: Record<string, any> = {};
    const arrayFilters: Record<string, any>[] = [];

    dto.items.forEach((item, index) => {
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
      populationArray: PRODUCT_POPULATION_OPTIONS as any,
    });

    return { success: true, data: populatedPlan };
  }

  /**
   * Core Generation Logic for Daily Production Plan
   */
  async generateProductionPlan(
    restaurantId: Types.ObjectId,
    dateStr: string,
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
      return emptyPlan as DailyProductionPlanType;
    }

    // 3. Compute 14-day avgDailySales per product
    const cutoffDate = new Date(`${dateStr}T00:00:00.000Z`);
    const startDate = new Date(cutoffDate);
    startDate.setUTCDate(
      startDate.getUTCDate() - AVG_DAILY_SALES_LOOKBACK_DAYS,
    );

    const salesList =
      (await this.salesTransactionRepository.findMany({
        filters: {
          restaurantId,
          date: { $gte: startDate, $lt: cutoffDate },
          isDeleted: false,
        },
      })) || [];

    // Sum sales per product
    const salesMap = new Map<string, number>();
    for (const sale of salesList) {
      const pId = sale.productId ? sale.productId.toString() : '';
      if (pId) {
        const currentSum = salesMap.get(pId) || 0;
        salesMap.set(pId, currentSum + (sale.quantitySold || 0));
      }
    }

    const preparedProducts = products.map((prod: any) => {
      const pIdStr = prod._id.toString();
      const totalSold = salesMap.get(pIdStr) || 0;
      const avgDailySales =
        Math.round((totalSold / AVG_DAILY_SALES_LOOKBACK_DAYS) * 100) / 100;
      const categoryName =
        prod.category && typeof prod.category === 'object' && prod.category.name
          ? prod.category.name
          : 'General';

      return {
        productId: pIdStr,
        title: prod.title || 'Product',
        category: categoryName,
        price: prod.price || 0,
        freshnessWindow: prod.freshnessWindow || 2,
        avgDailySales,
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

    const aiResponse = aiResult.ok && aiResult.data?.items ? aiResult.data : null;

    let planItems: any[] = [];
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
      // AI failure -> Fallback handling
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
          recQty = prepProd.avgDailySales;
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
      return created as DailyProductionPlanType;
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
   * Cron Job 1: Midnight Daily Production Plan Generation (12:00 AM)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: BUSINESS_TIMEZONE })
  async handleDailyPlanGeneration() {
    this.logger.log(
      'Executing midnight daily production plan generation cron...',
    );
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

        const records = sales.map((s: any) => ({
          // Derive the key from the Cairo day the sale actually happened on —
          // `toISOString().split('T')[0]` would attribute a sale near Cairo
          // midnight to the previous UTC day.
          date: s.date ? getBusinessDateString(new Date(s.date)) : yesterdayStr,
          productId: s.productId ? s.productId.toString() : '',
          salesQty: s.quantitySold || 0,
        }));

        // Sending `products: []` made the registry auto-register each product
        // with title=productId and category=None, so every product resolved to
        // neutral calendar priors. Send the real metadata.
        const products =
          (await this.productRepository.findMany({
            filters: { restaurantId: restId, isDeleted: false },
            populationArray: [{ path: 'category' }],
          })) || [];

        await this.aiIngestService.ingest({
          restaurantId: restId.toString(),
          records,
          products: products.map((p: any) => ({
            productId: p._id.toString(),
            title: p.title || 'Product',
            category:
              p.category && typeof p.category === 'object' && p.category.name
                ? p.category.name
                : undefined,
          })),
        });
      } catch (err: any) {
        this.logger.error(
          `Failed nightly AI learning sync for restaurant ${rest._id}: ${err?.message || err}`,
        );
      }
    }
  }
}
