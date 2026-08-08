import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  KnowledgeVectorRepository,
  ProductRepository,
  RecipeRepository,
  OfferRepository,
  WasteReportRepository,
  RecommendationRepository,
  IngredientRepository,
} from 'src/DB/Repositories';
import { BedrockEmbeddingService } from './bedrock-embedding.service';

export type KnowledgeEntityType =
  | 'product'
  | 'recipe'
  | 'offer'
  | 'waste_report'
  | 'recommendation'
  | 'weekly_snapshot';

export interface UpsertVectorParams {
  restaurantId: Types.ObjectId;
  entityType: KnowledgeEntityType;
  entityId: Types.ObjectId;
  textContent: string;
  metadata?: Record<string, any>;
}

export interface KnowledgeMatch {
  entityType: string;
  entityId: Types.ObjectId;
  textContent: string;
  metadata?: Record<string, any>;
}

export interface KnowledgeSearchResult {
  matches: KnowledgeMatch[];
  /** True when the matches are not semantically ranked. Surface this to the user. */
  degraded: boolean;
  degradedReason?: string;
}

function toKnowledgeMatch(doc: any): KnowledgeMatch {
  return {
    entityType: doc.entityType,
    entityId: doc.entityId,
    textContent: doc.textContent,
    metadata: doc.metadata,
  };
}

@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);

  constructor(
    private readonly knowledgeVectorRepo: KnowledgeVectorRepository,
    private readonly bedrockEmbeddingService: BedrockEmbeddingService,
    private readonly productRepo: ProductRepository,
    private readonly recipeRepo: RecipeRepository,
    private readonly offerRepo: OfferRepository,
    private readonly wasteReportRepo: WasteReportRepository,
    private readonly recommendationRepo: RecommendationRepository,
    private readonly ingredientRepo: IngredientRepository,
  ) {}

  /** Returns false when the vector could not be written, so callers can count honestly. */
  async upsertEntityVector(params: UpsertVectorParams): Promise<boolean> {
    const { restaurantId, entityType, entityId, textContent, metadata = {} } = params;

    if (!textContent || textContent.trim().length === 0) {
      return false;
    }

    try {
      const embedding = await this.bedrockEmbeddingService.generateEmbedding(
        textContent,
        'search_document',
      );

      const filter = {
        restaurantId,
        entityType,
        entityId,
      };

      const existing = await this.knowledgeVectorRepo.findOne({ filters: filter as any });

      if (existing) {
        await this.knowledgeVectorRepo.update({
          filters: filter as any,
          body: {
            textContent,
            embedding,
            metadata,
            isDeleted: false,
          },
        });
      } else {
        await this.knowledgeVectorRepo.create({
          restaurantId,
          entityType,
          entityId,
          textContent,
          embedding,
          metadata,
          isDeleted: false,
        });
      }

      this.logger.log(
        `Upserted vector for [${entityType}:${entityId}] in restaurant [${restaurantId}]`,
      );
      return true;
    } catch (error: any) {
      this.logger.error(
        `Failed to upsert vector for [${entityType}:${entityId}]: ${error?.message || error}`,
      );
      return false;
    }
  }

  async syncAllRestaurantVectors(
    restaurantId: Types.ObjectId,
  ): Promise<{ syncedCount: number; failedCount: number }> {
    this.logger.log(`Syncing all entity vectors for restaurant [${restaurantId}]...`);
    let syncedCount = 0;
    let failedCount = 0;

    // Counting only successful writes: this used to increment unconditionally,
    // so a run where every embedding call failed still reported full success.
    const track = (ok: boolean) => (ok ? syncedCount++ : failedCount++);

    // 1. Products
    const products =
      (await this.productRepo.findMany({ filters: { restaurantId, isDeleted: false } as any })) || [];
    for (const p of products) {
      const productTitle = p.title || (p as any).name || 'منتج';
      const textContent = `Product: ${productTitle} | Description: ${p.description || ''} ${p.longDescription || ''} | Price: ${p.price} EGP | Tags: ${(p.tags || []).join(', ')}`;
      track(
        await this.upsertEntityVector({
          restaurantId,
          entityType: 'product',
          entityId: p._id as Types.ObjectId,
          textContent,
          metadata: { title: productTitle, price: p.price },
        }),
      );
    }

    // 2. Recipes
    const recipes =
      (await this.recipeRepo.findMany({ filters: { restaurantId, isDeleted: false } as any })) || [];
    const allIngredients =
      (await this.ingredientRepo.findMany({ filters: { restaurantId, isDeleted: false } as any })) || [];
    const ingMap = new Map<string, any>();
    allIngredients.forEach((ing) => ingMap.set((ing._id as any).toString(), ing));

    for (const r of recipes) {
      const product = products.find((p) => (p._id as any).toString() === (r.productId as any).toString());
      const productTitle = product ? product.title || (product as any).name : 'Product';

      const ingDetails = (r.ingredients || [])
        .map((ri: any) => {
          const doc = ingMap.get(ri.ingredientId?.toString());
          const name = doc?.name || 'Ingredient';
          return `${name}: ${ri.quantityPerPortion} ${ri.unit}`;
        })
        .join(', ');

      const textContent = `Recipe for Product [${productTitle}]: Ingredients: ${ingDetails || 'None'}`;

      track(
        await this.upsertEntityVector({
          restaurantId,
          entityType: 'recipe',
          entityId: r._id as Types.ObjectId,
          textContent,
          metadata: { productId: r.productId, productTitle, ingredientsCount: r.ingredients?.length || 0 },
        }),
      );
    }

    // 3. Offers
    const offers =
      (await this.offerRepo.findMany({ filters: { restaurantId, isDeleted: false } as any })) || [];
    for (const o of offers) {
      const product = products.find((p) => (p._id as any).toString() === (o.productId as any).toString());
      const productTitle = product ? product.title || (product as any).name : 'Product';
      const textContent = `Promotional Offer: ${o.discountPercentage}% off on ${productTitle} | Status: ${o.status}`;
      track(
        await this.upsertEntityVector({
          restaurantId,
          entityType: 'offer',
          entityId: o._id as Types.ObjectId,
          textContent,
          metadata: { productId: o.productId, status: o.status },
        }),
      );
    }

    // 4. Waste reports — the entityType enum and searchKnowledge's entityTypes
    //    filter have always accepted these, but nothing ever wrote them, so
    //    filtering by 'waste_report' could only ever return nothing.
    const wasteReports =
      (await this.wasteReportRepo.findMany({ filters: { restaurantId, isDeleted: false } as any })) || [];
    const ingredients =
      (await this.ingredientRepo.findMany({ filters: { restaurantId, isDeleted: false } as any })) || [];
    for (const w of wasteReports) {
      const ingredient = ingredients.find(
        (i) => (i._id as any).toString() === (w.ingredientId as any).toString(),
      );
      const ingredientName = ingredient ? (ingredient as any).name || (ingredient as any).title : 'Ingredient';
      const textContent = `Waste Report for [${ingredientName}]: expected consumption ${w.expectedConsumption}, usable stock ${w.usableAvailableStock}, expected surplus ${w.expectedSurplus} | Risk: ${(w as any).riskLevel || 'unknown'}`;
      track(
        await this.upsertEntityVector({
          restaurantId,
          entityType: 'waste_report',
          entityId: w._id as Types.ObjectId,
          textContent,
          metadata: { ingredientId: w.ingredientId, ingredientName, riskLevel: (w as any).riskLevel },
        }),
      );
    }

    // 5. Recommendations
    const recommendations =
      (await this.recommendationRepo.findMany({ filters: { restaurantId, isDeleted: false } as any })) || [];
    for (const rec of recommendations) {
      const product = products.find((p) => (p._id as any).toString() === (rec.productId as any).toString());
      const productTitle = product ? product.title || (product as any).name : 'Product';
      const textContent = `Recommendation [${rec.type}] for ${productTitle}: suggested value ${rec.suggestedValue ?? 'n/a'} | Status: ${rec.status} | ${rec.gptExplanation || ''}`;
      track(
        await this.upsertEntityVector({
          restaurantId,
          entityType: 'recommendation',
          entityId: rec._id as Types.ObjectId,
          textContent,
          metadata: { productId: rec.productId, productTitle, type: rec.type },
        }),
      );
    }

    this.logger.log(
      `Completed vector sync for restaurant [${restaurantId}]: ${syncedCount} vectors updated, ${failedCount} failed.`,
    );
    return { syncedCount, failedCount };
  }

  /**
   * Semantic search over the restaurant's embedded knowledge.
   *
   * Returns `degraded: true` whenever the answer is NOT semantically ranked, so
   * the caller can say so instead of presenting keyword hits as vector matches.
   * An empty, non-degraded result is a real answer: the index worked and
   * nothing was similar enough.
   */
  async searchKnowledge(
    restaurantId: Types.ObjectId,
    queryText: string,
    limit = 5,
    entityTypes?: string[],
  ): Promise<KnowledgeSearchResult> {
    const safeLimit = Math.min(Math.max(limit, 1), 10);

    let queryVector: number[];
    try {
      queryVector = await this.bedrockEmbeddingService.generateEmbedding(
        queryText,
        'search_query',
      );
    } catch (error: any) {
      const reason = `Could not embed the query (${error?.message || error}); fell back to keyword matching.`;
      this.logger.error(`searchKnowledge DEGRADED for [${restaurantId}]: ${reason}`);
      return {
        matches: await this.keywordSearch(restaurantId, queryText, safeLimit, entityTypes),
        degraded: true,
        degradedReason: reason,
      };
    }

    const outcome = await this.knowledgeVectorRepo.vectorSearch(
      restaurantId,
      queryVector,
      safeLimit,
      entityTypes,
    );

    if (outcome.vectorSearchUsed) {
      return { matches: outcome.matches.map(toKnowledgeMatch), degraded: false };
    }

    // $vectorSearch is unavailable (not an Atlas deployment, or the index is
    // missing). Keyword matching is at least *relevant* to the query, unlike
    // the old `.find().limit()` and "return the first N products" fallbacks —
    // but it is not semantic, so the answer is flagged degraded.
    return {
      matches: await this.keywordSearch(restaurantId, queryText, safeLimit, entityTypes),
      degraded: true,
      degradedReason: outcome.reason,
    };
  }

  /**
   * Literal token match over the already-embedded text. Deliberately returns
   * nothing when nothing matches — an empty answer beats a confident wrong one.
   */
  private async keywordSearch(
    restaurantId: Types.ObjectId,
    queryText: string,
    limit: number,
    entityTypes?: string[],
  ): Promise<KnowledgeMatch[]> {
    const keywords = queryText
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((w) => w.length > 1);

    if (keywords.length === 0) return [];

    const filters: Record<string, any> = {
      restaurantId,
      isDeleted: false,
      $or: keywords.map((k) => ({ textContent: { $regex: new RegExp(k, 'i') } })),
    };
    if (entityTypes && entityTypes.length > 0) {
      filters.entityType = { $in: entityTypes };
    }

    const found = (await this.knowledgeVectorRepo.findMany({ filters: filters as any })) || [];
    return found.slice(0, limit).map(toKnowledgeMatch);
  }

  async softDeleteEntityVector(
    restaurantId: Types.ObjectId,
    entityType: string,
    entityId: Types.ObjectId,
  ): Promise<void> {
    await this.knowledgeVectorRepo.update({
      filters: { restaurantId, entityType, entityId } as any,
      body: { isDeleted: true },
    });
  }
}
