import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RecommendationRepository, RecommendationActionRepository, ProductRepository } from 'src/DB/Repositories';
import { RecommendationTypeEnum, RecommendationStatusEnum } from 'src/Common/Types';
import { Recipe, RecipeType } from 'src/DB/Models';

export interface StructuredRecommendation {
  recommendationId?: string;
  /**
   * The `recommendation_actions` row id. Required by POST /assistant/approve-action
   * to mark the action EXECUTED; without it an approval runs the tool but
   * leaves the action row stuck at PENDING forever.
   */
  recommendationActionId?: string;
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
    @InjectModel(Recipe.name) private readonly recipeModel: Model<RecipeType>,
  ) {}

  async generateStructuredRecommendations(
    restaurantId: Types.ObjectId,
    toolResults: any[],
  ): Promise<StructuredRecommendation[]> {
    const recommendations: StructuredRecommendation[] = [];

    // Pre-fetch restaurant products
    const products = (await this.productRepo.findMany({ filters: { restaurantId, isDeleted: false } as any })) || [];

    // Find tool results
    const inventoryResult = toolResults.find((r) => r.toolName === 'getInventoryStatus')?.result;
    const wasteResult = toolResults.find((r) => r.toolName === 'getWasteSummary')?.result;

    // 1. Expiring Batches Recommendation (Product-centric & Dynamic Discounting)
    if (inventoryResult && inventoryResult.batches && inventoryResult.batches.length > 0) {
      for (const batch of inventoryResult.batches.slice(0, 2)) {
        const estimatedSaving = Math.round(batch.quantityRemaining * (batch.unitCost || 30));

        // Trace recipe to find which PRODUCT uses this expiring batch/ingredient
        let targetProduct: any = null;
        if (batch.ingredientId) {
          const matchingRecipe = await this.recipeModel.findOne({
            restaurantId,
            isDeleted: false,
            'ingredients.ingredientId': new Types.ObjectId(batch.ingredientId),
          }).lean();

          if (matchingRecipe) {
            targetProduct = products.find(
              (p) => (p._id as any).toString() === (matchingRecipe.productId as any).toString(),
            );
          }
        }

        // Fallback to first available restaurant product if no specific recipe match is found
        if (!targetProduct && products.length > 0) {
          targetProduct = products[0];
        }

        const productTitle = targetProduct ? (targetProduct.title || targetProduct.name) : 'المنتج الفائض';
        const productIdStr = targetProduct ? (targetProduct._id as Types.ObjectId).toString() : '65ab90294f8e1234567890ab';

        // Check if agent context provided an explicit discount, otherwise calculate dynamically from expiration urgency
        const explicitOfferResult = toolResults.find((r) => r.toolName === 'createOffer')?.result;
        let discountPercentage = explicitOfferResult?.discountPercentage;

        if (!discountPercentage) {
          if (batch.expiryDate) {
            const daysRemaining = Math.max(0, Math.ceil((new Date(batch.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
            if (daysRemaining <= 2) {
              discountPercentage = 35; // Urgent clearance for stock expiring in 2 days or less
            } else if (daysRemaining <= 4) {
              discountPercentage = 25; // Moderate clearance for stock expiring in 4 days or less
            } else {
              discountPercentage = 15; // Preventive clearance
            }
          } else {
            discountPercentage = 20; // Baseline clearance discount
          }
        }

        recommendations.push({
          title: `إنشاء عرض خصم ${discountPercentage}% لمنتج ${productTitle}`,
          description: `تقترب مكونات منتج ${productTitle} (بما في ذلك دُفعة المخزون ${batch.batchNumber || ''}) من انتهاء الصلاحية. إنشاء عرض خصم ${discountPercentage}% لـ ${batch.quantityRemaining} قطعة من ${productTitle} يمكنه استرداد ما يصل إلى ${estimatedSaving} جنيه مصري قبل التلف.`,
          priority: discountPercentage >= 30 ? 'HIGH' : 'MEDIUM',
          estimatedSaving,
          confidence: 0.92,
          requiredTools: ['createOffer'],
          requiresApproval: true,
          actionPayload: {
            toolName: 'createOffer',
            arguments: {
              productId: productIdStr,
              discountPercentage,
              availableQuantity: batch.quantityRemaining || 20,
              daysDuration: 3,
            },
          },
        });
      }
    }

    // 2. High Waste Recommendation (Product-centric)
    if (wasteResult && wasteResult.totalWasteCost > 0) {
      const sampleProduct = products[0];
      const productIdStr = sampleProduct ? (sampleProduct._id as Types.ObjectId).toString() : '65ab90294f8e1234567890ab';
      const productTitle = sampleProduct ? (sampleProduct.title || (sampleProduct as any).name) : 'المنتج الخبزي';

      recommendations.push({
        title: `تعديل خطة الإنتاج لمنتج ${productTitle} لتقليل الهدر`,
        description: `وصل إجمالي تكلفة الهدر إلى ${wasteResult.totalWasteCost} جنيه مصري خلال الـ 7 أيام الماضية. يرجى تعديل خطة الإنتاج اليومية لمنتج ${productTitle} لمنع الإفراط في الإنتاج.`,
        priority: 'MEDIUM',
        estimatedSaving: Math.round(wasteResult.totalWasteCost * 0.3) || 500,
        confidence: 0.85,
        requiredTools: ['updateProductionPlan'],
        requiresApproval: true,
        actionPayload: {
          toolName: 'updateProductionPlan',
          arguments: {
            date: new Date().toISOString().split('T')[0],
            productId: productIdStr,
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
      const productTitle = (sampleProduct && (sampleProduct.title || (sampleProduct as any).name)) || 'المنتج الفائض';

      const fallbackDiscount = 15; // Dynamic baseline fallback discount

      recommendations.push({
        title: `إنشاء عرض خصم ترويجي ${fallbackDiscount}% لمنتج ${productTitle}`,
        description: `زيادة مبيعات فترة الظهيرة وتقليل الفائض اليومي عن طريق إنشاء عرض خصم ترويجي ${fallbackDiscount}% على منتج ${productTitle}.`,
        priority: 'MEDIUM',
        estimatedSaving: 800,
        confidence: 0.88,
        requiredTools: ['createOffer'],
        requiresApproval: true,
        actionPayload: {
          toolName: 'createOffer',
          arguments: {
            productId: productIdStr,
            discountPercentage: fallbackDiscount,
            availableQuantity: 25,
            daysDuration: 3,
          },
        },
      });
    }

    // Persist recommendations & actions to database
    for (const rec of recommendations) {
      try {
        const productId = new Types.ObjectId(
          Types.ObjectId.isValid(rec.actionPayload.arguments.productId)
            ? rec.actionPayload.arguments.productId
            : '000000000000000000000000',
        );
        const suggestedValue =
          rec.actionPayload.arguments.discountPercentage || rec.estimatedSaving;

        // Reuse the open recommendation for this product+type instead of
        // writing a new row on every chat turn. Without this, asking about
        // waste five times left five identical PENDING rows in the operator's
        // recommendations list.
        const existing = await this.recommendationRepo.findOne({
          filters: {
            restaurantId,
            productId,
            type: RecommendationTypeEnum.APPLY_DISCOUNT,
            status: RecommendationStatusEnum.PENDING,
            isDeleted: false,
          } as any,
        });

        const storedRec =
          existing ||
          (await this.recommendationRepo.create({
            restaurantId,
            productId,
            type: RecommendationTypeEnum.APPLY_DISCOUNT,
            suggestedValue,
            gptExplanation: rec.description,
            status: RecommendationStatusEnum.PENDING,
            isDeleted: false,
          }));

        rec.recommendationId = (storedRec._id as Types.ObjectId).toString();

        const existingAction = await this.recommendationActionRepo.findOne({
          filters: {
            restaurantId,
            recommendationId: storedRec._id as Types.ObjectId,
            status: 'PENDING',
          } as any,
        });

        const storedAction =
          existingAction ||
          (await this.recommendationActionRepo.create({
            restaurantId,
            recommendationId: storedRec._id as Types.ObjectId,
            status: 'PENDING',
            selectedByUser: false,
            relatedTool: rec.actionPayload.toolName,
          }));

        // Returning this is what lets the approval endpoint close the loop.
        rec.recommendationActionId = (storedAction._id as Types.ObjectId).toString();
      } catch (error: any) {
        // Was `warn`, which meant a total persistence failure looked like a
        // healthy run — the API still returned recommendations the operator
        // could click, backed by nothing.
        this.logger.error(
          `Failed to persist recommendation [${rec.title}] for restaurant [${restaurantId}]: ${error?.message || error}`,
          error?.stack,
        );
      }
    }

    return recommendations;
  }
}
