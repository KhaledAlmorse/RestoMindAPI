import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
  OfferRepository,
  ProductRepository,
  RestaurantRepository,
} from 'src/DB/Repositories';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import {
  OfferStatusEnum,
  OfferSourceEnum,
  OfferDiscountTypeEnum,
} from 'src/Common/Types';
import { OfferAccessService } from './services/offer-access.service';
import { OfferRulesService } from './services/offer-rules.service';
import { OfferPricingService } from './services/offer-pricing.service';

@Injectable()
export class OffersService {
  constructor(
    private readonly offerRepository: OfferRepository,
    private readonly productRepository: ProductRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly offerAccessService: OfferAccessService,
    private readonly offerRulesService: OfferRulesService,
    private readonly offerPricingService: OfferPricingService,
  ) {}

  private parseStartDate(dateStr: string): Date {
    const trimmed = dateStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return new Date(`${trimmed}T00:00:00.000Z`);
    }
    return new Date(trimmed);
  }

  private parseEndDate(dateStr: string): Date {
    const trimmed = dateStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return new Date(`${trimmed}T23:59:59.999Z`);
    }
    return new Date(trimmed);
  }

  async createOffer(dto: CreateOfferDto, userId: string) {
    this.offerAccessService.validateObjectId(dto.productId);

    const managerRestaurantId =
      await this.offerAccessService.getManagerRestaurantId(userId);

    const restaurant = await this.restaurantRepository.findOne({
      filters: { _id: managerRestaurantId, isDeleted: false },
    });
    if (!restaurant || restaurant.isActive === false) {
      throw new BadRequestException(
        'Cannot create offer for an inactive restaurant',
      );
    }

    const product = await this.productRepository.findOne({
      filters: { _id: new Types.ObjectId(dto.productId), isDeleted: false },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.restaurantId.toString() !== managerRestaurantId.toString()) {
      throw new ForbiddenException(
        'You can only create offers for products in your own restaurant',
      );
    }

    const startDate = this.parseStartDate(dto.startDate);
    const endDate = this.parseEndDate(dto.endDate);
    const now = new Date();

    if (startDate >= endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }
    if (endDate <= now) {
      throw new BadRequestException('endDate must be in the future');
    }

    await this.offerRulesService.assertNoOverlap(
      dto.productId,
      startDate,
      endDate,
    );

    const pricing = this.offerPricingService.resolvePricing(product.price, {
      discountType: dto.discountType ?? OfferDiscountTypeEnum.PERCENTAGE,
      discountPercentage: dto.discountPercentage,
      offerPrice: dto.offerPrice,
    });

    let status = dto.status;
    if (status) {
      const creatableStatuses = [
        OfferStatusEnum.DRAFT,
        OfferStatusEnum.SCHEDULED,
        OfferStatusEnum.ACTIVE,
      ];
      if (!creatableStatuses.includes(status)) {
        throw new BadRequestException(
          `Offers can only be created with status: ${creatableStatuses.join(', ')}`,
        );
      }
      if (status === OfferStatusEnum.ACTIVE) {
        if (startDate > now) {
          throw new BadRequestException(
            'status cannot be active when startDate is in the future',
          );
        }
        const conflict = await this.offerRulesService.assertActiveConflict(
          dto.productId,
        );
        if (conflict) {
          throw new ConflictException(
            'This product already has an active offer',
          );
        }
      }
    } else {
      status = this.offerRulesService.deriveStatus(startDate, now);
    }

    if (
      (status === OfferStatusEnum.DRAFT ||
        status === OfferStatusEnum.SCHEDULED) &&
      startDate < now
    ) {
      throw new BadRequestException(
        'startDate must be in the future for a draft/scheduled offer',
      );
    }

    const availableQuantity = dto.availableQuantity;
    const remainingQuantity = dto.availableQuantity;
    const maxPerCustomer = dto.maxPerCustomer ?? null;

    const offer = await this.offerRepository.create({
      productId: new Types.ObjectId(dto.productId),
      restaurantId: managerRestaurantId,
      originalPrice: pricing.originalPrice,
      offerPrice: pricing.offerPrice,
      discountPercentage: pricing.discountPercentage,
      discountType: pricing.discountType,
      availableQuantity,
      remainingQuantity,
      maxPerCustomer,
      startDate,
      endDate,
      status,
      source: OfferSourceEnum.MANUAL,
      featured: dto.featured ?? false,
      createdBy: new Types.ObjectId(userId),
    } as any);

    return { data: offer };
  }

  async updateOffer(id: string, dto: UpdateOfferDto, userId: string) {
    const managerRestaurantId =
      await this.offerAccessService.getManagerRestaurantId(userId);
    this.offerAccessService.validateObjectId(id);

    const offer = await this.offerRepository.findOne({
      filters: { _id: new Types.ObjectId(id), isDeleted: false },
    });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }

    if (offer.restaurantId.toString() !== managerRestaurantId.toString()) {
      throw new ForbiddenException(
        'You can only update offers belonging to your restaurant',
      );
    }

    if (
      offer.status === OfferStatusEnum.EXPIRED ||
      offer.status === OfferStatusEnum.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot edit an offer with status "${offer.status}"`,
      );
    }

    if (
      dto.startDate &&
      offer.status !== OfferStatusEnum.DRAFT &&
      offer.status !== OfferStatusEnum.SCHEDULED
    ) {
      throw new BadRequestException(
        'startDate can only be changed while the offer is draft or scheduled',
      );
    }

    const now = new Date();
    const updateBody: Record<string, any> = {};
    let effectiveStartDate: Date | undefined;

    // Pricing (percentage OR fixed offerPrice)
    if (
      dto.discountType !== undefined ||
      dto.discountPercentage !== undefined ||
      dto.offerPrice !== undefined
    ) {
      const product = await this.productRepository.findOne({
        filters: { _id: offer.productId, isDeleted: false },
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }
      const pricing = this.offerPricingService.resolvePricing(product.price, {
        discountType: dto.discountType ?? offer.discountType,
        discountPercentage: dto.discountPercentage,
        offerPrice: dto.offerPrice,
      });
      updateBody.originalPrice = pricing.originalPrice;
      updateBody.offerPrice = pricing.offerPrice;
      updateBody.discountPercentage = pricing.discountPercentage;
      updateBody.discountType = pricing.discountType;
    }

    // Quantity
    if (dto.availableQuantity !== undefined) {
      const sold = offer.availableQuantity - offer.remainingQuantity;
      if (dto.availableQuantity < sold) {
        throw new BadRequestException(
          `availableQuantity cannot be less than the ${sold} unit(s) already sold`,
        );
      }
      const delta = dto.availableQuantity - offer.availableQuantity;
      const newRemaining = offer.remainingQuantity + delta;
      updateBody.availableQuantity = dto.availableQuantity;
      updateBody.remainingQuantity = newRemaining;

      if (
        offer.status === OfferStatusEnum.SOLD_OUT &&
        newRemaining > 0 &&
        now >= offer.startDate &&
        now <= offer.endDate
      ) {
        const conflict = await this.offerRulesService.assertActiveConflict(
          offer.productId.toString(),
          id,
        );
        if (!conflict) {
          updateBody.status = OfferStatusEnum.ACTIVE;
        }
      }
    }

    if (dto.maxPerCustomer !== undefined) {
      updateBody.maxPerCustomer = dto.maxPerCustomer;
    }

    if (dto.featured !== undefined) {
      updateBody.featured = dto.featured;
    }

    // Dates — re-run the create-time validations plus overlap check
    if (dto.startDate || dto.endDate) {
      effectiveStartDate = dto.startDate
        ? this.parseStartDate(dto.startDate)
        : new Date(offer.startDate);
      const effectiveEndDate = dto.endDate
        ? this.parseEndDate(dto.endDate)
        : new Date(offer.endDate);

      if (effectiveStartDate >= effectiveEndDate) {
        throw new BadRequestException('startDate must be before endDate');
      }
      if (effectiveEndDate <= now) {
        throw new BadRequestException('endDate must be in the future');
      }

      await this.offerRulesService.assertNoOverlap(
        offer.productId.toString(),
        effectiveStartDate,
        effectiveEndDate,
        id,
      );

      if (dto.startDate) updateBody.startDate = effectiveStartDate;
      if (dto.endDate) updateBody.endDate = effectiveEndDate;

      if (
        offer.status === OfferStatusEnum.DRAFT ||
        offer.status === OfferStatusEnum.SCHEDULED
      ) {
        const derived = this.offerRulesService.deriveStatus(
          effectiveStartDate,
          now,
        );

        if (derived === OfferStatusEnum.ACTIVE) {
          const conflict = await this.offerRulesService.assertActiveConflict(
            offer.productId.toString(),
            id,
          );
          updateBody.status = conflict
            ? OfferStatusEnum.SCHEDULED
            : OfferStatusEnum.ACTIVE;
        } else {
          updateBody.status = OfferStatusEnum.SCHEDULED;
        }
      }
    }

    // Explicit status change — wins over any status implied above
    if (dto.status !== undefined) {
      this.offerRulesService.assertStatusTransition(offer.status, dto.status);
      if (dto.status === OfferStatusEnum.ACTIVE) {
        const conflict = await this.offerRulesService.assertActiveConflict(
          offer.productId.toString(),
          id,
        );
        if (conflict) {
          throw new ConflictException(
            'This product already has an active offer',
          );
        }
      }
      updateBody.status = dto.status;
    }

    if (effectiveStartDate && effectiveStartDate < now) {
      const finalStatus = updateBody.status ?? offer.status;
      if (
        finalStatus === OfferStatusEnum.DRAFT ||
        finalStatus === OfferStatusEnum.SCHEDULED
      ) {
        throw new BadRequestException(
          'startDate must be in the future for a draft/scheduled offer',
        );
      }
    }

    const updated = await this.offerRepository.update({
      filters: { _id: new Types.ObjectId(id) },
      body: updateBody,
    });

    return { data: updated };
  }

  async cancelOffer(id: string, userId: string) {
    const managerRestaurantId =
      await this.offerAccessService.getManagerRestaurantId(userId);
    this.offerAccessService.validateObjectId(id);

    const offer = await this.offerRepository.findOne({
      filters: { _id: new Types.ObjectId(id), isDeleted: false },
    });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }

    if (offer.restaurantId.toString() !== managerRestaurantId.toString()) {
      throw new ForbiddenException(
        'You can only cancel offers belonging to your restaurant',
      );
    }

    if (offer.status === OfferStatusEnum.CANCELLED) {
      throw new BadRequestException('Offer is already cancelled');
    }
    if (offer.status === OfferStatusEnum.EXPIRED) {
      throw new BadRequestException('Cannot cancel an expired offer');
    }
    if (offer.endDate <= new Date()) {
      throw new BadRequestException(
        'Cannot cancel an offer whose end date has passed',
      );
    }

    await this.offerRepository.update({
      filters: { _id: new Types.ObjectId(id) },
      body: { status: OfferStatusEnum.CANCELLED } as any,
    });

    const updated = await this.offerRepository.findOne({
      filters: { _id: new Types.ObjectId(id) },
    });
    return { data: updated };
  }

  /**
   * Restores units from a cancelled order item and reactivates a sold-out
   * offer when the restock lands back inside its live window with no
   * conflicting active offer for the same product.
   */
  async restockFromCancelledOrderItem(
    offerId: Types.ObjectId | string,
    quantity: number,
    lineTotal = 0,
  ) {
    const id =
      typeof offerId === 'string' ? new Types.ObjectId(offerId) : offerId;

    await this.offerRepository.update({
      filters: { _id: id },
      body: { $inc: { remainingQuantity: quantity } } as any,
    });

    const updatedOffer = await this.offerRepository.findOne({
      filters: { _id: id },
    });
    if (!updatedOffer) return;

    const now = new Date();
    if (
      updatedOffer.status === OfferStatusEnum.SOLD_OUT &&
      updatedOffer.remainingQuantity > 0 &&
      now >= updatedOffer.startDate &&
      now <= updatedOffer.endDate
    ) {
      const conflict = await this.offerRulesService.assertActiveConflict(
        updatedOffer.productId.toString(),
        updatedOffer._id.toString(),
      );
      if (!conflict) {
        await this.offerRepository.update({
          filters: { _id: id },
          body: { status: OfferStatusEnum.ACTIVE } as any,
        });
      }
    }

    if (updatedOffer.recommendationId) {
      await this.offerRepository.update({
        filters: { _id: id },
        body: {
          $inc: {
            actualUnitsSold: -quantity,
            actualRevenueRecovered: -lineTotal,
          },
        } as any,
      });
    }
  }
}
