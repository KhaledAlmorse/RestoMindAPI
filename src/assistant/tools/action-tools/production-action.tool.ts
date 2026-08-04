import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ToolRegistryService, ToolContext } from '../tool-registry.service';
import { DailyProductionPlanRepository } from 'src/DB/Repositories';

const UpdateProductionPlanSchema = z.object({
  date: z.string().describe('YYYY-MM-DD date of production plan'),
  productId: z.string(),
  newRecommendedQty: z.number().min(0),
});

const SendNotificationSchema = z.object({
  recipientRole: z.enum(['kitchen_staff', 'manager', 'all']).default('kitchen_staff'),
  message: z.string().min(2),
});

@Injectable()
export class ProductionActionTool implements OnModuleInit {
  private readonly logger = new Logger(ProductionActionTool.name);

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly productionPlanRepo: DailyProductionPlanRepository,
  ) {}

  onModuleInit() {
    this.toolRegistry.registerTool({
      name: 'updateProductionPlan',
      description: 'Updates recommended kitchen baking quantities for a specific date and product.',
      schema: UpdateProductionPlanSchema,
      requiresApproval: true,
      handler: (params, context) => this.updateProductionPlan(params, context),
    });

    this.toolRegistry.registerTool({
      name: 'sendNotification',
      description: 'Triggers alert notifications to kitchen staff or restaurant managers.',
      schema: SendNotificationSchema,
      requiresApproval: true,
      handler: (params, context) => this.sendNotification(params, context),
    });
  }

  async updateProductionPlan(params: z.infer<typeof UpdateProductionPlanSchema>, context: ToolContext) {
    const { date, productId, newRecommendedQty } = params;
    const { restaurantId } = context;

    const plan = await this.productionPlanRepo.findOne({
      filters: { restaurantId, date, isDeleted: false } as any,
    });
    if (!plan) {
      throw new Error(`Daily production plan for date [${date}] not found.`);
    }

    const itemIndex = plan.items.findIndex(
      (item: any) => item.productId.toString() === productId,
    );

    if (itemIndex >= 0) {
      plan.items[itemIndex].recommendedQty = newRecommendedQty;
    } else {
      plan.items.push({
        productId: productId as any,
        recommendedQty: newRecommendedQty,
        confidence: 'MEDIUM' as any,
        source: 'MANUAL_OVERRIDE' as any,
      });
    }

    const totalRecommendedQty = plan.items.reduce(
      (sum: number, item: any) => sum + item.recommendedQty,
      0,
    );

    await this.productionPlanRepo.update({
      filters: { _id: plan._id } as any,
      body: { items: plan.items, totalRecommendedQty },
    });

    return {
      success: true,
      date,
      productId,
      newRecommendedQty,
      totalRecommendedQty,
    };
  }

  async sendNotification(params: z.infer<typeof SendNotificationSchema>, context: ToolContext) {
    const { recipientRole, message } = params;
    const { restaurantId } = context;

    this.logger.log(
      `Sending Notification to [${recipientRole}] for restaurant [${restaurantId}]: "${message}"`,
    );

    return {
      success: true,
      recipientRole,
      message,
      sentAt: new Date(),
    };
  }
}
