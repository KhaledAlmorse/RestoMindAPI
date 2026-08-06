import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ToolRegistryService, ToolContext } from '../tool-registry.service';
import { SalesTransactionRepository } from 'src/DB/Repositories';

const GetSalesComparisonSchema = z.object({
  windowDays: z.number().default(7),
  productId: z.string().optional(),
});

@Injectable()
export class SalesQueryTool implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly salesRepo: SalesTransactionRepository,
  ) {}

  onModuleInit() {
    this.toolRegistry.registerTool({
      name: 'getSalesComparison',
      description: 'Compares period-over-period sales revenue, item volumes, and top selling products.',
      schema: GetSalesComparisonSchema,
      requiresApproval: false,
      handler: (params, context) => this.getSalesComparison(params, context),
    });
  }

  async getSalesComparison(params: z.infer<typeof GetSalesComparisonSchema>, context: ToolContext) {
    const { windowDays } = params;
    const { restaurantId } = context;

    const currentPeriodStart = new Date();
    currentPeriodStart.setDate(currentPeriodStart.getDate() - windowDays);

    const previousPeriodStart = new Date(currentPeriodStart);
    previousPeriodStart.setDate(previousPeriodStart.getDate() - windowDays);

    // Current Window Sales
    const currentSales = await this.salesRepo.aggregate([
      {
        $match: {
          restaurantId,
          date: { $gte: currentPeriodStart },
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: '$productId',
          revenue: { $sum: '$sellingPrice' },
          units: { $sum: '$quantitySold' },
        },
      },
      { $sort: { revenue: -1 } },
    ]);

    // Previous Window Sales
    const previousSales = await this.salesRepo.aggregate([
      {
        $match: {
          restaurantId,
          date: { $gte: previousPeriodStart, $lt: currentPeriodStart },
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$sellingPrice' },
          units: { $sum: '$quantitySold' },
        },
      },
    ]);

    const currentRevenue = currentSales.reduce((sum, item) => sum + item.revenue, 0);
    const currentUnits = currentSales.reduce((sum, item) => sum + item.units, 0);
    const previousRevenue = previousSales[0]?.revenue || 0;
    const previousUnits = previousSales[0]?.units || 0;

    const revenueGrowthPct = previousRevenue > 0
      ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100)
      : 0;

    return {
      windowDays,
      currentRevenue,
      currentUnits,
      previousRevenue,
      previousUnits,
      revenueGrowthPct,
      topSellingProducts: currentSales.slice(0, 5),
    };
  }
}
