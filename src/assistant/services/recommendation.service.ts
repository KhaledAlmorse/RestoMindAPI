import { Injectable, Logger } from '@nestjs/common';
import { RecommendationRepository, RecommendationActionRepository, ProductRepository } from 'src/DB/Repositories';
import { RecommendationTypeEnum, RecommendationStatusEnum } from 'src/Common/Types';
import { Types } from 'mongoose';

export interface StructuredRecommendation {
  recommendationId?: string;
  title: string;
  description: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  estimatedSaving: number;
  confidence: number;
  requiredTools: string[];
  requiresApproval: boolean;
  actionPayload: {
    toolName: string;
    arguments: Record<string, any>;
  };
}

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(
    private readonly recommendationRepo: RecommendationRepository,
    private readonly recommendationActionRepo: RecommendationActionRepository,
    private readonly productRepo: ProductRepository,
  ) {}

  async generateStructuredRecommendations(
    restaurantId: Types.ObjectId,
    toolResults: any[],
  ): Promise<StructuredRecommendation[]> {
    const recommendations: StructuredRecommendation[] = [];

    // Find tool results
    const inventoryResult = toolResults.find((r) => r.toolName === 'getInventoryStatus')?.result;
    const wasteResult = toolResults.find((r) => r.toolName === 'getWasteSummary')?.result;

    // 1. Expiring Batches Recommendation
    if (inventoryResult && inventoryResult.batches && inventoryResult.batches.length > 0) {
      for (const batch of inventoryResult.batches.slice(0, 2)) {
        const estimatedSaving = Math.round(batch.quantityRemaining * (batch.unitCost || 30));

        recommendations.push({
          title: `Create 25% Discount Offer for Expiring Stock (Batch ${batch.batchNumber || 'EXP-101'})`,
          description: `Batch ${batch.batchNumber || 'EXP-101'} expires soon. Creating a discount offer for ${batch.quantityRemaining} units can recover up to ${estimatedSaving} EGP before spoilage.`,
          priority: 'HIGH',
          estimatedSaving,
          confidence: 0.92,
          requiredTools: ['createOffer'],
          requiresApproval: true,
          actionPayload: {
            toolName: 'createOffer',
            arguments: {
              productId: (batch.ingredientId || '65ab90294f8e1234567890ab').toString(),
              discountPercentage: 25,
              availableQuantity: batch.quantityRemaining || 20,
              daysDuration: 3,
            },
          },
        });
      }
    }

    // 2. High Waste Recommendation
    if (wasteResult && wasteResult.totalWasteCost > 0) {
      recommendations.push({
        title: 'Review Production Baking Checklist to Mitigate Waste',
        description: `Total waste reached ${wasteResult.totalWasteCost} EGP in the last 7 days. Adjust tomorrow's kitchen baking checklist to prevent overproduction.`,
        priority: 'MEDIUM',
        estimatedSaving: Math.round(wasteResult.totalWasteCost * 0.3) || 500,
        confidence: 0.85,
        requiredTools: ['updateProductionPlan'],
        requiresApproval: true,
        actionPayload: {
          toolName: 'updateProductionPlan',
          arguments: {
            date: new Date().toISOString().split('T')[0],
            productId: wasteResult.topWastedIngredients?.[0]?._id?.toString() || '65ab90294f8e1234567890ab',
            newRecommendedQty: 20,
          },
        },
      });
    }

    // 3. Fallback General Smart Recommendation if no specific conditions triggered
    if (recommendations.length === 0) {
      const products = (await this.productRepo.findMany({ filters: { restaurantId, isDeleted: false } as any })) || [];
      const sampleProduct = products[0];
      const productIdStr = sampleProduct ? (sampleProduct._id as Types.ObjectId).toString() : '65ab90294f8e1234567890ab';
      const productTitle = sampleProduct ? sampleProduct.title : 'Bakery Surplus Item';

      recommendations.push({
        title: `Create 20% Promotional Discount for ${productTitle}`,
        description: `Boost afternoon sales and prevent end-of-day surplus waste by creating a 20% promotional discount on ${productTitle}.`,
        priority: 'MEDIUM',
        estimatedSaving: 800,
        confidence: 0.88,
        requiredTools: ['createOffer'],
        requiresApproval: true,
        actionPayload: {
          toolName: 'createOffer',
          arguments: {
            productId: productIdStr,
            discountPercentage: 20,
            availableQuantity: 25,
            daysDuration: 3,
          },
        },
      });
    }

    // Persist recommendations & actions to database
    for (const rec of recommendations) {
      try {
        const storedRec = await this.recommendationRepo.create({
          restaurantId,
          productId: new Types.ObjectId(
            Types.ObjectId.isValid(rec.actionPayload.arguments.productId)
              ? rec.actionPayload.arguments.productId
              : '000000000000000000000000',
          ),
          type: RecommendationTypeEnum.APPLY_DISCOUNT,
          suggestedValue: rec.actionPayload.arguments.discountPercentage || rec.estimatedSaving,
          gptExplanation: rec.description,
          status: RecommendationStatusEnum.PENDING,
          isDeleted: false,
        });

        rec.recommendationId = (storedRec._id as Types.ObjectId).toString();

        await this.recommendationActionRepo.create({
          restaurantId,
          recommendationId: storedRec._id as Types.ObjectId,
          status: 'PENDING',
          selectedByUser: false,
          relatedTool: rec.actionPayload.toolName,
        });
      } catch (error: any) {
        this.logger.warn(`Failed to persist recommendation: ${error?.message || error}`);
      }
    }

    return recommendations;
  }
}
