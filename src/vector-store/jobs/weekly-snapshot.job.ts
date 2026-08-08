import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BUSINESS_TIMEZONE, getBusinessDateString } from 'src/Common/Utils/date.util';
import {
  RestaurantRepository,
  SalesTransactionRepository,
  WasteEventRepository,
  WeeklyExecutiveSnapshotRepository,
  PredictionRepository,
} from 'src/DB/Repositories';
import { VectorStoreService } from '../vector-store.service';
import { Types } from 'mongoose';

@Injectable()
export class WeeklySnapshotJob {
  private readonly logger = new Logger(WeeklySnapshotJob.name);

  constructor(
    private readonly restaurantRepo: RestaurantRepository,
    private readonly salesRepo: SalesTransactionRepository,
    private readonly wasteEventRepo: WasteEventRepository,
    private readonly predictionRepo: PredictionRepository,
    private readonly snapshotRepo: WeeklyExecutiveSnapshotRepository,
    private readonly vectorStoreService: VectorStoreService,
  ) {}

  // Was `CronExpression.EVERY_WEEKEND`, which is `0 0 * * 6,0` — midnight on
  // BOTH Saturday and Sunday, in the container's timezone, despite the comment
  // claiming Sunday 01:00. 04:00 is the first Sunday hour not already taken by
  // another AI job (00:00 predictions, 01:00/02:00 daily, 03:00 accuracy);
  // src/Common/cron-schedule.spec.ts enforces that.
  @Cron('0 4 * * 0', { timeZone: BUSINESS_TIMEZONE })
  async handleWeeklyExecutiveSnapshots(): Promise<void> {
    this.logger.log('Starting Sunday Weekly Executive Snapshot Cron Job...');

    try {
      const restaurants = (await this.restaurantRepo.findMany({ filters: { isDeleted: false } as any })) || [];
      // `toISOString()` is UTC: at 04:00 Cairo it still reports the previous
      // calendar day, mislabelling every snapshot by one day.
      const targetWeek = getBusinessDateString();

      for (const restaurant of restaurants) {
        await this.generateSnapshotForRestaurant(restaurant._id as Types.ObjectId, targetWeek);
      }

      this.logger.log('Completed Weekly Executive Snapshot Cron Job.');
    } catch (error: any) {
      this.logger.error(`Weekly Executive Snapshot Cron failed: ${error?.message || error}`);
    }
  }

  async generateSnapshotForRestaurant(
    restaurantId: Types.ObjectId,
    targetWeek: string,
  ): Promise<void> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // 1. Calculate Total Sales Revenue & Top Selling Product
    const salesStats = await this.salesRepo.aggregate([
      {
        $match: {
          restaurantId,
          date: { $gte: sevenDaysAgo },
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: '$productId',
          totalRevenue: { $sum: '$sellingPrice' },
          totalUnits: { $sum: '$quantitySold' },
        },
      },
      { $sort: { totalRevenue: -1 } },
    ]);

    const totalSalesRevenue = salesStats.reduce((sum, item) => sum + item.totalRevenue, 0);
    const topProductId = salesStats[0]?._id ? salesStats[0]._id.toString() : 'None';

    // 2. Calculate Total Waste Cost & Top Wasted Ingredient
    const wasteStats = await this.wasteEventRepo.aggregate([
      {
        $match: {
          restaurantId,
          date: { $gte: sevenDaysAgo },
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: '$ingredientId',
          totalCost: { $sum: '$estimatedCost' },
        },
      },
      { $sort: { totalCost: -1 } },
    ]);

    const totalWasteCost = wasteStats.reduce((sum, item) => sum + item.totalCost, 0);
    const topWastedIngredient = wasteStats[0]?._id ? wasteStats[0]._id.toString() : 'None';

    // 3. Estimate AI Prediction Accuracy
    const predictions = (await this.predictionRepo.findMany({
      filters: {
        restaurantId,
        targetWeek,
        isDeleted: false,
      } as any,
    })) || [];

    let totalErrorRatio = 0;
    let countedPredictions = 0;

    for (const pred of predictions) {
      if (pred.actualOrders !== null && pred.actualOrders !== undefined && pred.predictedOrders > 0) {
        const error = Math.abs(pred.predictedOrders - pred.actualOrders) / pred.predictedOrders;
        totalErrorRatio += error;
        countedPredictions++;
      }
    }

    const aiPredictionAccuracy =
      countedPredictions > 0
        ? Math.max(0, Math.round((1 - totalErrorRatio / countedPredictions) * 100))
        : 85; // Default baseline accuracy

    const narrativeSummary = `Weekly Executive Summary for Week [${targetWeek}]: Total Sales Revenue: ${totalSalesRevenue.toFixed(2)} EGP. Total Waste Cost: ${totalWasteCost.toFixed(2)} EGP. Primary Waste Driver: Ingredient [${topWastedIngredient}]. Top Performing Item: Product [${topProductId}]. AI Forecasting Accuracy: ${aiPredictionAccuracy}%.`;

    // 4. Save to weekly_executive_snapshots
    const snapshot = await this.snapshotRepo.create({
      restaurantId,
      targetWeek,
      totalSalesRevenue,
      totalWasteCost,
      topWastedIngredient,
      topSellingProduct: topProductId,
      aiPredictionAccuracy,
      narrativeSummary,
      isDeleted: false,
    });

    // 5. Vectorize into knowledge_vectors
    await this.vectorStoreService.upsertEntityVector({
      restaurantId,
      entityType: 'weekly_snapshot',
      entityId: snapshot._id as Types.ObjectId,
      textContent: narrativeSummary,
      metadata: {
        targetWeek,
        totalSalesRevenue,
        totalWasteCost,
        aiPredictionAccuracy,
      },
    });

    this.logger.log(`Generated Weekly Executive Snapshot for restaurant [${restaurantId}]`);
  }
}
