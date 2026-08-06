import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ToolRegistryService, ToolContext } from '../tool-registry.service';
import { WasteEventRepository } from 'src/DB/Repositories';

const GetWasteSummarySchema = z.object({
  period: z.enum(['7_days', '30_days', 'all_time']).default('7_days'),
  wasteReason: z.string().optional(),
});

@Injectable()
export class WasteQueryTool implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly wasteEventRepo: WasteEventRepository,
  ) {}

  onModuleInit() {
    this.toolRegistry.registerTool({
      name: 'getWasteSummary',
      description: 'Calculates total waste cost, top waste reasons, and impacted ingredient breakdown.',
      schema: GetWasteSummarySchema,
      requiresApproval: false,
      handler: (params, context) => this.getWasteSummary(params, context),
    });
  }

  async getWasteSummary(params: z.infer<typeof GetWasteSummarySchema>, context: ToolContext) {
    const { period, wasteReason } = params;
    const { restaurantId } = context;

    const startDate = new Date();
    if (period === '7_days') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === '30_days') {
      startDate.setDate(startDate.getDate() - 30);
    } else {
      startDate.setFullYear(2020);
    }

    const matchStage: any = {
      restaurantId,
      date: { $gte: startDate },
      isDeleted: false,
    };

    if (wasteReason) {
      matchStage.wasteReason = wasteReason;
    }

    const summaryByReason = await this.wasteEventRepo.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$wasteReason',
          totalCost: { $sum: '$estimatedCost' },
          totalQuantity: { $sum: '$quantity' },
          eventCount: { $sum: 1 },
        },
      },
      { $sort: { totalCost: -1 } },
    ]);

    const summaryByIngredient = await this.wasteEventRepo.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$ingredientId',
          totalCost: { $sum: '$estimatedCost' },
          totalQuantity: { $sum: '$quantity' },
        },
      },
      { $sort: { totalCost: -1 } },
      { $limit: 5 },
    ]);

    const totalCost = summaryByReason.reduce((sum, r) => sum + r.totalCost, 0);

    return {
      period,
      totalWasteCost: totalCost,
      topWasteReason: summaryByReason[0]?._id || 'None',
      breakdownByReason: summaryByReason,
      topWastedIngredients: summaryByIngredient,
    };
  }
}
