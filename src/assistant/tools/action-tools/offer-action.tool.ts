import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ToolRegistryService, ToolContext } from '../tool-registry.service';
import { OfferRepository, ProductRepository } from 'src/DB/Repositories';
import { OfferStatusEnum, OfferSourceEnum } from 'src/Common/Types';
import { EntityChangeListener } from 'src/vector-store/listeners/entity-change.listener';
import { Types } from 'mongoose';

const CreateOfferSchema = z.object({
  productId: z.string().describe('MongoDB ObjectId of product'),
  discountPercentage: z.number().min(1).max(90),
  availableQuantity: z.number().min(1),
  daysDuration: z.number().default(3),
});

const ScheduleDiscountSchema = z.object({
  productId: z.string(),
  discountPercentage: z.number().min(1).max(90),
  startDate: z.string(),
  endDate: z.string(),
  availableQuantity: z.number().min(1),
});

@Injectable()
export class OfferActionTool implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly offerRepo: OfferRepository,
    private readonly productRepo: ProductRepository,
    private readonly entityChangeListener: EntityChangeListener,
  ) {}

  onModuleInit() {
    this.toolRegistry.registerTool({
      name: 'createOffer',
      description: 'Creates a promotional discount offer for a product to clear excess inventory.',
      schema: CreateOfferSchema,
      requiresApproval: true,
      handler: (params, context) => this.createOffer(params, context),
    });

    this.toolRegistry.registerTool({
      name: 'scheduleDiscount',
      description: 'Schedules a future promotional discount on expiring inventory.',
      schema: ScheduleDiscountSchema,
      requiresApproval: true,
      handler: (params, context) => this.scheduleDiscount(params, context),
    });
  }

  async createOffer(params: z.infer<typeof CreateOfferSchema>, context: ToolContext) {
    const { productId, discountPercentage, availableQuantity, daysDuration } = params;
    const { restaurantId, userId } = context;

    const product = await this.productRepo.findOne({
      filters: { _id: new Types.ObjectId(productId), restaurantId, isDeleted: false } as any,
    });
    if (!product) {
      throw new Error(`Product [${productId}] not found for restaurant.`);
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + daysDuration);

    const offerPrice = Math.round(product.price * (1 - discountPercentage / 100));

    const offer = await this.offerRepo.create({
      restaurantId,
      productId: product._id,
      originalPrice: product.price,
      offerPrice,
      discountPercentage,
      availableQuantity,
      remainingQuantity: availableQuantity,
      startDate,
      endDate,
      status: OfferStatusEnum.ACTIVE,
      source: OfferSourceEnum.AI_RECOMMENDATION,
      createdBy: userId,
      isDeleted: false,
    });

    // Sync knowledge vector
    await this.entityChangeListener.onOfferChanged(offer, product.title);

    return {
      success: true,
      offerId: offer._id,
      productTitle: product.title,
      originalPrice: product.price,
      offerPrice,
      discountPercentage,
      availableQuantity,
    };
  }

  async scheduleDiscount(params: z.infer<typeof ScheduleDiscountSchema>, context: ToolContext) {
    const { productId, discountPercentage, startDate, endDate, availableQuantity } = params;
    const { restaurantId, userId } = context;

    const product = await this.productRepo.findOne({
      filters: { _id: new Types.ObjectId(productId), restaurantId, isDeleted: false } as any,
    });
    if (!product) {
      throw new Error(`Product [${productId}] not found.`);
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const offerPrice = Math.round(product.price * (1 - discountPercentage / 100));

    const offer = await this.offerRepo.create({
      restaurantId,
      productId: product._id,
      originalPrice: product.price,
      offerPrice,
      discountPercentage,
      availableQuantity,
      remainingQuantity: availableQuantity,
      startDate: start,
      endDate: end,
      status: OfferStatusEnum.SCHEDULED,
      source: OfferSourceEnum.AI_RECOMMENDATION,
      createdBy: userId,
      isDeleted: false,
    });

    return {
      success: true,
      offerId: offer._id,
      productTitle: product.title,
      scheduledStartDate: start,
      scheduledEndDate: end,
    };
  }
}
