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

export interface UpsertVectorParams {
  restaurantId: Types.ObjectId;
  entityType: 'product' | 'recipe' | 'offer' | 'waste_report' | 'recommendation' | 'weekly_snapshot';
  entityId: Types.ObjectId;
  textContent: string;
  metadata?: Record<string, any>;
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

  async upsertEntityVector(params: UpsertVectorParams): Promise<void> {
    const { restaurantId, entityType, entityId, textContent, metadata = {} } = params;

    if (!textContent || textContent.trim().length === 0) {
      return;
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
    } catch (error: any) {
      this.logger.error(
        `Failed to upsert vector for [${entityType}:${entityId}]: ${error?.message || error}`,
      );
    }
  }

  async syncAllRestaurantVectors(restaurantId: Types.ObjectId): Promise<{ syncedCount: number }> {
    this.logger.log(`Syncing all entity vectors for restaurant [${restaurantId}]...`);
    let syncedCount = 0;

    // 1. Sync Products
    const products = (await this.productRepo.findMany({ filters: { restaurantId, isDeleted: false } as any })) || [];
    for (const p of products) {
      const productTitle = p.title || (p as any).name || 'منتج';
      const textContent = `Product: ${productTitle} | Description: ${p.description || ''} ${p.longDescription || ''} | Price: ${p.price} EGP | Tags: ${(p.tags || []).join(', ')}`;
      await this.upsertEntityVector({
        restaurantId,
        entityType: 'product',
        entityId: p._id as Types.ObjectId,
        textContent,
        metadata: { title: productTitle, price: p.price },
      });
      syncedCount++;
    }

    // 2. Sync Recipes
    const recipes = (await this.recipeRepo.findMany({ filters: { restaurantId, isDeleted: false } as any })) || [];
    for (const r of recipes) {
      const product = products.find((p) => (p._id as any).toString() === (r.productId as any).toString());
      const productTitle = product ? product.title || (product as any).name : 'Product';
      const textContent = `Recipe for Product [${productTitle}]: Contains ${r.ingredients?.length || 0} ingredients.`;
      await this.upsertEntityVector({
        restaurantId,
        entityType: 'recipe',
        entityId: r._id as Types.ObjectId,
        textContent,
        metadata: { productId: r.productId, productTitle },
      });
      syncedCount++;
    }

    // 3. Sync Offers
    const offers = (await this.offerRepo.findMany({ filters: { restaurantId, isDeleted: false } as any })) || [];
    for (const o of offers) {
      const product = products.find((p) => (p._id as any).toString() === (o.productId as any).toString());
      const productTitle = product ? product.title || (product as any).name : 'Product';
      const textContent = `Promotional Offer: ${o.discountPercentage}% off on ${productTitle} | Status: ${o.status}`;
      await this.upsertEntityVector({
        restaurantId,
        entityType: 'offer',
        entityId: o._id as Types.ObjectId,
        textContent,
        metadata: { productId: o.productId, status: o.status },
      });
      syncedCount++;
    }

    this.logger.log(`Completed vector sync for restaurant [${restaurantId}]: ${syncedCount} vectors updated.`);
    return { syncedCount };
  }

  async searchKnowledge(
    restaurantId: Types.ObjectId,
    queryText: string,
    limit = 5,
    entityTypes?: string[],
  ) {
    const queryVector = await this.bedrockEmbeddingService.generateEmbedding(
      queryText,
      'search_query',
    );

    let matches = await this.knowledgeVectorRepo.vectorSearch(
      restaurantId,
      queryVector,
      limit,
      entityTypes,
    );

    // If vectorSearch returned 0 matches, perform auto-sync and keyword hybrid search
    if (!matches || matches.length === 0) {
      await this.syncAllRestaurantVectors(restaurantId);
      matches = await this.knowledgeVectorRepo.vectorSearch(
        restaurantId,
        queryVector,
        limit,
        entityTypes,
      );
    }

    // Hybrid Text Search Fallback if Atlas Vector Search is not indexed
    if (!matches || matches.length === 0) {
      const keywords = queryText
        .replace(/[^\w\s\u0600-\u06FF]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 1);

      if (keywords.length > 0) {
        const regexFilter = keywords.map((k) => new RegExp(k, 'i'));
        const directMatches = (await this.knowledgeVectorRepo.findMany({
          filters: {
            restaurantId,
            isDeleted: false,
            $or: regexFilter.map((r) => ({ textContent: { $regex: r } })),
          } as any,
        })) || [];

        if (directMatches.length > 0) {
          return directMatches.slice(0, limit);
        }
      }

      // Direct Product & Recipe Fallback
      const products = (await this.productRepo.findMany({
        filters: { restaurantId, isDeleted: false } as any,
      })) || [];

      const queryTerm = keywords[keywords.length - 1] || queryText;
      const matchedProducts = products.filter((p) => {
        const title = p.title || (p as any).name || '';
        return (
          title.toLowerCase().includes(queryTerm.toLowerCase()) ||
          p.description?.toLowerCase().includes(queryTerm.toLowerCase()) ||
          p.longDescription?.toLowerCase().includes(queryTerm.toLowerCase())
        );
      });

      if (matchedProducts.length > 0) {
        return matchedProducts.slice(0, limit).map((p) => {
          const productTitle = p.title || (p as any).name || 'منتج';
          return {
            entityType: 'product',
            entityId: p._id as Types.ObjectId,
            textContent: `Product: ${productTitle} | Description: ${p.description || ''} | Price: ${p.price} EGP`,
            metadata: { title: productTitle, price: p.price },
          };
        });
      }

      // Fallback to returning top products if available
      if (products.length > 0) {
        return products.slice(0, limit).map((p) => {
          const productTitle = p.title || (p as any).name || 'منتج';
          return {
            entityType: 'product',
            entityId: p._id as Types.ObjectId,
            textContent: `Product: ${productTitle} | Description: ${p.description || ''} | Price: ${p.price} EGP`,
            metadata: { title: productTitle, price: p.price },
          };
        });
      }
    }

    return matches || [];
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
