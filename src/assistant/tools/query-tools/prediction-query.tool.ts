import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ToolRegistryService, ToolContext } from '../tool-registry.service';
import { PredictionRepository, WeeklyExecutiveSnapshotRepository } from 'src/DB/Repositories';

const GetPredictionsSchema = z.object({
  horizon: z.enum(['7_days', 'today']).default('7_days'),
  productId: z.string().optional(),
});

const GenerateExecutiveReportSchema = z.object({
  period: z.enum(['last_week', 'this_month']).default('last_week'),
});

@Injectable()
export class PredictionQueryTool implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly predictionRepo: PredictionRepository,
    private readonly snapshotRepo: WeeklyExecutiveSnapshotRepository,
  ) {}

  onModuleInit() {
    this.toolRegistry.registerTool({
      name: 'getPredictions',
      description: 'Fetches AI demand predictions, order forecasts, and confidence levels.',
      schema: GetPredictionsSchema,
      requiresApproval: false,
      handler: (params, context) => this.getPredictions(params, context),
    });

    this.toolRegistry.registerTool({
      name: 'generateExecutiveReport',
      description: 'Compiles high-level operational, sales, waste, and forecasting performance summaries.',
      schema: GenerateExecutiveReportSchema,
      requiresApproval: false,
      handler: (params, context) => this.generateExecutiveReport(params, context),
    });
  }

  async getPredictions(params: z.infer<typeof GetPredictionsSchema>, context: ToolContext) {
    const { productId } = params;
    const { restaurantId } = context;

    const filter: Record<string, any> = { restaurantId, isDeleted: false };
    if (productId) {
      filter.productId = productId;
    }

    const predictions = (await this.predictionRepo.findMany({ filters: filter as any })) || [];

    return {
      totalPredictions: predictions.length,
      items: predictions.map((p) => ({
        productId: p.productId,
        targetWeek: p.targetWeek,
        predictedOrders: p.predictedOrders,
        confidence: p.confidence,
        dailyBreakdown: p.dailyBreakdown,
        factors: p.factors,
      })),
    };
  }

  async generateExecutiveReport(params: z.infer<typeof GenerateExecutiveReportSchema>, context: ToolContext) {
    const { restaurantId } = context;

    const latestSnapshots = (await this.snapshotRepo.findMany({
      filters: { restaurantId, isDeleted: false } as any,
      select: 'targetWeek totalSalesRevenue totalWasteCost topSellingProduct topWastedIngredient aiPredictionAccuracy narrativeSummary',
    })) || [];

    return {
      reportPeriod: params.period,
      snapshotsCount: latestSnapshots.length,
      history: latestSnapshots,
    };
  }
}
