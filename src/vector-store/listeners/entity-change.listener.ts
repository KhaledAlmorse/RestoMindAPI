import { Injectable, Logger } from '@nestjs/common';
import { VectorStoreService } from '../vector-store.service';
import { Types } from 'mongoose';

@Injectable()
export class EntityChangeListener {
  private readonly logger = new Logger(EntityChangeListener.name);

  constructor(private readonly vectorStoreService: VectorStoreService) {}

  async onProductChanged(product: any): Promise<void> {
    if (!product || !product._id || !product.restaurantId) return;

    const textContent = `Product: ${product.title} | Category: ${product.category?.name || 'General'} | Description: ${product.description || ''} ${product.longDescription || ''} | Price: ${product.price} EGP | Expected Daily Sales: ${product.expectedDailySales ?? 'N/A'} | Tags: ${(product.tags || []).join(', ')}`;

    await this.vectorStoreService.upsertEntityVector({
      restaurantId: new Types.ObjectId(product.restaurantId),
      entityType: 'product',
      entityId: new Types.ObjectId(product._id),
      textContent,
      metadata: {
        title: product.title,
        price: product.price,
        isAvailable: product.isAvailable,
      },
    });
  }

  async onRecipeChanged(recipe: any, productTitle: string): Promise<void> {
    if (!recipe || !recipe._id || !recipe.restaurantId) return;

    const ingredientsList = (recipe.ingredients || [])
      .map(
        (ing: any) =>
          `${ing.ingredientId?.name || 'Ingredient'} (${ing.quantityPerPortion} ${ing.unit})`,
      )
      .join(', ');

    const textContent = `Recipe for Product [${productTitle}]: Requires ${ingredientsList}`;

    await this.vectorStoreService.upsertEntityVector({
      restaurantId: new Types.ObjectId(recipe.restaurantId),
      entityType: 'recipe',
      entityId: new Types.ObjectId(recipe._id),
      textContent,
      metadata: {
        productId: recipe.productId,
        productTitle,
      },
    });
  }

  async onOfferChanged(offer: any, productTitle: string): Promise<void> {
    if (!offer || !offer._id || !offer.restaurantId) return;

    const textContent = `Promotional Offer: ${offer.discountPercentage}% off on ${productTitle} | Original Price: ${offer.originalPrice} EGP, Offer Price: ${offer.offerPrice} EGP | Status: ${offer.status} | Available Qty: ${offer.availableQuantity} | Remaining: ${offer.remainingQuantity}`;

    await this.vectorStoreService.upsertEntityVector({
      restaurantId: new Types.ObjectId(offer.restaurantId),
      entityType: 'offer',
      entityId: new Types.ObjectId(offer._id),
      textContent,
      metadata: {
        productId: offer.productId,
        discountPercentage: offer.discountPercentage,
        status: offer.status,
      },
    });
  }

  async onWasteReportChanged(report: any, ingredientName: string): Promise<void> {
    if (!report || !report._id || !report.restaurantId) return;

    const textContent = `Waste Surplus Report for [${ingredientName}]: Expected Surplus: ${report.expectedSurplus} | Usable Stock: ${report.usableAvailableStock} | Risk Level: ${report.riskLevel}`;

    await this.vectorStoreService.upsertEntityVector({
      restaurantId: new Types.ObjectId(report.restaurantId),
      entityType: 'waste_report',
      entityId: new Types.ObjectId(report._id),
      textContent,
      metadata: {
        ingredientId: report.ingredientId,
        riskLevel: report.riskLevel,
      },
    });
  }

  async onRecommendationChanged(recommendation: any, productTitle: string): Promise<void> {
    if (!recommendation || !recommendation._id || !recommendation.restaurantId) return;

    const textContent = `AI Recommendation (${recommendation.type}): ${recommendation.gptExplanation || ''} | Suggested Value: ${recommendation.suggestedValue ?? 'N/A'} | Product: ${productTitle} | Status: ${recommendation.status}`;

    await this.vectorStoreService.upsertEntityVector({
      restaurantId: new Types.ObjectId(recommendation.restaurantId),
      entityType: 'recommendation',
      entityId: new Types.ObjectId(recommendation._id),
      textContent,
      metadata: {
        type: recommendation.type,
        productId: recommendation.productId,
        status: recommendation.status,
      },
    });
  }
}
