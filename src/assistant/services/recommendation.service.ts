import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  RecommendationActionRepository,
  ProductRepository,
  DailyProductionPlanRepository,
} from 'src/DB/Repositories';
import { getBusinessDateString } from 'src/Common/Utils/date.util';
import { RecommendationsService } from 'src/recommendations/recommendations.service';
import { ActionApprovalToken } from './action-approval-token';

export interface StructuredRecommendation {
  recommendationId?: string;
  /**
   * The `recommendation_actions` row id. Required by POST /assistant/approve-action
   * to mark the action EXECUTED; without it an approval runs the tool but
   * leaves the action row stuck at PENDING forever.
   */
  recommendationActionId?: string;
  /**
   * Signed proof of exactly what `actionPayload` was proposed. Approval only
   * ever executes what this token carries, never client-supplied toolName/
   * arguments, so approving can't be tricked into running a different action.
   */
  approvalToken?: string;
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

/**
 * Builds the assistant's actionable recommendation cards from REAL data only.
 *
 * This used to run a second, fully separate recommendation engine that never
 * called the AI forecasting service at all: hardcoded discount tiers, hardcoded
 * confidence scores (0.92/0.85/0.88, never computed from anything), a fake
 * placeholder ObjectId when no real product existed, and hardcoded fallback
 * quantities -- all presented to the operator as normal recommendations, with
 * no `degraded` flag distinguishing them from the real thing (every other
 * fallback path in this codebase is marked `FALLBACK_NAIVE`/`degraded: true`;
 * this one wasn't, because it was never trying to be a fallback).
 *
 * Surplus/discount recommendations now delegate to
 * `RecommendationsService.scanSurplusForRestaurant` -- the same AI-backed,
 * backend-verified surplus scan the Stores screen uses (real productId, real
 * `suggestedDiscountPct` and `riskScore` from the AI service, real persisted
 * `Recommendation` rows) -- instead of duplicating that request/response
 * shape here with invented numbers. When there is genuinely nothing at risk,
 * this returns fewer (or zero) recommendations rather than manufacturing one.
 */
@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(
    private readonly recommendationActionRepo: RecommendationActionRepository,
    private readonly productRepo: ProductRepository,
    private readonly dailyProductionPlanRepo: DailyProductionPlanRepository,
    private readonly recommendationsService: RecommendationsService,
  ) {}

  async generateStructuredRecommendations(
    restaurantId: Types.ObjectId,
    toolResults: any[],
  ): Promise<StructuredRecommendation[]> {
    const recommendations: StructuredRecommendation[] = [];

    // 1. Surplus / discount recommendations -- real AI call, real persisted
    // Recommendation rows, backend-verified against actual surplus risk. This
    // replaces the old per-batch loop that hand-picked a discount tier from
    // days-to-expiry and attached it to `products[0]` (or a fake ObjectId) if
    // the tool result didn't name a specific product.
    const surplusScan =
      await this.recommendationsService.scanSurplusForRestaurant(restaurantId);

    for (const item of surplusScan.data.itemsAtRisk || []) {
      const rec = (surplusScan.data.recommendations || []).find(
        (r: any) => r.productId?.toString() === item.productId,
      );
      if (!rec) continue; // no persisted row -> nothing an approval could act on

      recommendations.push({
        recommendationId: (rec._id as Types.ObjectId).toString(),
        title: `إنشاء عرض خصم ${item.suggestedDiscountPct}% لمنتج ${item.title}`,
        description:
          item.offerCopyAr ||
          `مخزون ${item.title} معرض لخطر الفائض (${item.projectedSurplus} قطعة متوقع عدم بيعها). عرض خصم ${item.suggestedDiscountPct}% يمكنه تقليل الهدر.`,
        priority:
          item.urgency === 'high' ? 'HIGH' : item.urgency === 'low' ? 'LOW' : 'MEDIUM',
        // Real value at risk (stock likely to go unsold, at its own price),
        // not an invented figure.
        estimatedSaving: Math.round(
          (item.projectedSurplus || 0) * (item.newPrice ?? 0),
        ),
        // The AI's own risk score: how sure it is this stock goes unsold,
        // which is exactly what this recommendation proposes to act on.
        confidence: typeof item.riskScore === 'number' ? item.riskScore : 0.5,
        requiredTools: ['createOffer'],
        requiresApproval: true,
        actionPayload: {
          toolName: 'createOffer',
          arguments: {
            productId: item.productId,
            discountPercentage: item.suggestedDiscountPct,
            availableQuantity: item.currentStock,
            daysDuration: 3,
          },
        },
      });
    }

    // 2. Production-plan recommendation, only when the AI's OWN production
    // plan for today already suggests less than what's currently planned --
    // a real, already-computed signal (recommendedQty vs. lowerBound), not a
    // guessed replacement quantity. Skipped entirely (rather than fabricated)
    // when no such plan/signal exists.
    const wasteResult = toolResults.find(
      (r) => r.toolName === 'getWasteSummary',
    )?.result;
    if (wasteResult && wasteResult.totalWasteCost > 0) {
      const todayStr = getBusinessDateString();
      const plan = await this.dailyProductionPlanRepo.findOne({
        filters: { restaurantId, date: todayStr, isDeleted: false },
      });
      const overProduced = (plan?.items || [])
        .filter((i: any) => (i.lowerBound ?? 0) < i.recommendedQty)
        .sort(
          (a: any, b: any) =>
            b.recommendedQty - (b.lowerBound ?? 0) -
            (a.recommendedQty - (a.lowerBound ?? 0)),
        )[0];

      if (overProduced) {
        const products =
          (await this.productRepo.findMany({
            filters: { restaurantId, isDeleted: false },
          } as any)) || [];
        const product = products.find(
          (p: any) => p._id.toString() === overProduced.productId.toString(),
        );
        const productTitle = product?.title || 'المنتج';
        const confidence =
          overProduced.confidence === 'high'
            ? 0.9
            : overProduced.confidence === 'low'
              ? 0.5
              : 0.7;

        recommendations.push({
          title: `تعديل خطة الإنتاج لمنتج ${productTitle} لتقليل الهدر`,
          description: `وصل إجمالي تكلفة الهدر إلى ${wasteResult.totalWasteCost} جنيه مصري. نموذج التنبؤ يقترح إنتاج ${overProduced.lowerBound} قطعة بدلاً من ${overProduced.recommendedQty} المخطط لها حالياً لمنتج ${productTitle}.`,
          priority: 'MEDIUM',
          estimatedSaving: Math.round(wasteResult.totalWasteCost),
          confidence,
          requiredTools: ['updateProductionPlan'],
          requiresApproval: true,
          actionPayload: {
            toolName: 'updateProductionPlan',
            arguments: {
              date: todayStr,
              productId: overProduced.productId.toString(),
              newRecommendedQty: overProduced.lowerBound,
            },
          },
        });
      }
    }

    // Sign every proposed action, and attach the recommendation_actions audit
    // row for whichever recommendations already have a real recommendationId
    // (the surplus ones, from RecommendationsService's own persistence). The
    // production-plan recommendation has no matching RecommendationTypeEnum
    // value to persist under, so it is signed but not audited here -- the
    // approval endpoint still executes it from the signed token, it just
    // won't have an action row to mark EXECUTED (same documented behaviour as
    // any recommendation missing a recommendationActionId).
    for (const rec of recommendations) {
      rec.approvalToken = ActionApprovalToken.sign(
        restaurantId,
        rec.actionPayload.toolName,
        rec.actionPayload.arguments,
      );

      if (!rec.recommendationId) continue;

      try {
        const recommendationObjectId = new Types.ObjectId(rec.recommendationId);
        const existingAction = await this.recommendationActionRepo.findOne({
          filters: {
            restaurantId,
            recommendationId: recommendationObjectId,
            status: 'PENDING',
          } as any,
        });

        const storedAction =
          existingAction ||
          (await this.recommendationActionRepo.create({
            restaurantId,
            recommendationId: recommendationObjectId,
            status: 'PENDING',
            selectedByUser: false,
            relatedTool: rec.actionPayload.toolName,
          }));

        // Returning this is what lets the approval endpoint close the loop.
        rec.recommendationActionId = (
          storedAction._id as Types.ObjectId
        ).toString();
      } catch (error: any) {
        // Was `warn`, which meant a total persistence failure looked like a
        // healthy run — the API still returned recommendations the operator
        // could click, backed by nothing.
        this.logger.error(
          `Failed to persist recommendation action [${rec.title}] for restaurant [${restaurantId}]: ${error?.message || error}`,
          error?.stack,
        );
      }
    }

    return recommendations;
  }
}
