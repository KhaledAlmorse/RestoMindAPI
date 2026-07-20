import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { isValidObjectId, Types } from 'mongoose';
import {
  OfferRepository,
  ProductRepository,
  RestaurantRepository,
} from 'src/DB/Repositories';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { QueryOfferDto } from './dto/query-offer.dto';
import { OfferStatusEnum, OfferSourceEnum } from 'src/Common/Types';

@Injectable()
export class OffersService {
  constructor(
    private readonly offerRepository: OfferRepository,
    private readonly productRepository: ProductRepository,
    private readonly restaurantRepository: RestaurantRepository,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  private async checkOverlap(productId: string, excludeOfferId?: string) {
    const filters: Record<string, any> = {
      productId: new Types.ObjectId(productId),
      status: { $in: [OfferStatusEnum.ACTIVE, OfferStatusEnum.SCHEDULED] },
      isDeleted: false,
    };
    if (excludeOfferId) {
      filters._id = { $ne: new Types.ObjectId(excludeOfferId) };
    }
    const existing = await this.offerRepository.findOne({ filters });
    if (existing) {
      throw new ConflictException(
        'This product already has an active or scheduled offer',
      );
    }
  }

  async syncProductDiscountedPrice(productId: string) {
    const product = await this.productRepository.findOne({
      filters: { _id: productId, isDeleted: false },
    });
    if (!product) return;

    const activeOffer = await this.offerRepository.findOne({
      filters: {
        productId: new Types.ObjectId(productId),
        status: OfferStatusEnum.ACTIVE,
        isDeleted: false,
      },
    });

    if (activeOffer) {
      const discountedPrice =
        Math.round(
          product.price * (1 - activeOffer.discountPercentage / 100) * 100,
        ) / 100;
      await this.productRepository.update({
        filters: { _id: productId },
        body: { discountedPrice } as any,
      });
    } else {
      await this.productRepository.update({
        filters: { _id: productId },
        body: { discountedPrice: product.price } as any,
      });
    }
  }

  async createOffer(dto: CreateOfferDto, userId: string) {
    this.validateObjectId(dto.productId);

    const product = await this.productRepository.findOne({
      filters: { _id: dto.productId, isDeleted: false },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const restaurantId = product.restaurantId.toString();
    const restaurant = await this.restaurantRepository.findOne({
      filters: { _id: restaurantId, isDeleted: false },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    await this.checkOverlap(dto.productId);

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    const now = new Date();

    if (startDate >= endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }
    if (endDate <= now) {
      throw new BadRequestException('endDate must be in the future');
    }

    const status =
      startDate <= now ? OfferStatusEnum.ACTIVE : OfferStatusEnum.SCHEDULED;

    const offer = await this.offerRepository.create({
      productId: new Types.ObjectId(dto.productId),
      restaurantId: new Types.ObjectId(restaurantId),
      discountPercentage: dto.discountPercentage,
      startDate,
      endDate,
      status,
      source: OfferSourceEnum.MANUAL,
      featured: dto.featured ?? false,
      createdBy: new Types.ObjectId(userId),
    } as any);

    if (status === OfferStatusEnum.ACTIVE) {
      await this.syncProductDiscountedPrice(dto.productId);
    }

    return { data: offer };
  }

  async getOffers(query: QueryOfferDto) {
    const { status, productId, source } = query;
    const filters: Record<string, any> = { isDeleted: false };

    if (status) {
      if (!Object.values(OfferStatusEnum).includes(status as OfferStatusEnum)) {
        throw new BadRequestException(`Invalid status: ${status}`);
      }
      filters.status = status;
    }
    if (productId) {
      this.validateObjectId(productId);
      filters.productId = new Types.ObjectId(productId);
    }
    if (source) {
      if (!Object.values(OfferSourceEnum).includes(source as OfferSourceEnum)) {
        throw new BadRequestException(`Invalid source: ${source}`);
      }
      filters.source = source;
    }

    const offers = await this.offerRepository.findMany({
      filters,
      populationArray: [
        { path: 'productId' },
        { path: 'createdBy', select: 'name email' },
      ],
    });
    return { data: offers };
  }

  async getOfferById(id: string) {
    this.validateObjectId(id);
    const offer = await this.offerRepository.findOne({
      filters: { _id: id, isDeleted: false },
      populationArray: [
        { path: 'productId' },
        { path: 'createdBy', select: 'name email' },
      ],
    });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }
    return { data: offer };
  }

  async updateOffer(id: string, dto: UpdateOfferDto) {
    this.validateObjectId(id);
    const offer = await this.offerRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }

    if (
      offer.status !== OfferStatusEnum.DRAFT &&
      offer.status !== OfferStatusEnum.SCHEDULED
    ) {
      throw new BadRequestException(
        'Can only edit offers with status: draft or scheduled',
      );
    }

    const updateBody: Record<string, any> = { ...dto };
    if (dto.productId) {
      this.validateObjectId(dto.productId);
      const product = await this.productRepository.findOne({
        filters: { _id: dto.productId, isDeleted: false },
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }
      await this.checkOverlap(dto.productId, id);
      updateBody.productId = new Types.ObjectId(dto.productId);
      updateBody.restaurantId = product.restaurantId;
    }
    if (dto.startDate) {
      updateBody.startDate = new Date(dto.startDate);
    }
    if (dto.endDate) {
      updateBody.endDate = new Date(dto.endDate);
    }

    const updated = await this.offerRepository.update({
      filters: { _id: id },
      body: updateBody,
    });
    return { data: updated };
  }

  async cancelOffer(id: string) {
    this.validateObjectId(id);
    const offer = await this.offerRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }

    if (offer.status === OfferStatusEnum.CANCELLED) {
      throw new BadRequestException('Offer is already cancelled');
    }
    if (offer.status === OfferStatusEnum.EXPIRED) {
      throw new BadRequestException('Cannot cancel an expired offer');
    }

    await this.offerRepository.update({
      filters: { _id: id },
      body: { status: OfferStatusEnum.CANCELLED } as any,
    });

    const productId = offer.productId.toString();
    await this.syncProductDiscountedPrice(productId);

    const updated = await this.offerRepository.findOne({
      filters: { _id: id },
    });
    return { data: updated };
  }

  async getActiveOffers() {
    const now = new Date();
    const offers = await this.offerRepository.findMany({
      filters: {
        status: OfferStatusEnum.ACTIVE,
        isDeleted: false,
        startDate: { $lte: now },
        endDate: { $gte: now },
      },
      populationArray: [{ path: 'productId' }, { path: 'restaurantId' }],
    });
    return { data: offers };
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processStatusTransitions() {
    const now = new Date();

    const scheduledToActives = await this.offerRepository.findMany({
      filters: {
        status: OfferStatusEnum.SCHEDULED,
        startDate: { $lte: now },
        isDeleted: false,
      },
    });

    for (const offer of scheduledToActives) {
      await this.offerRepository.update({
        filters: { _id: offer._id },
        body: { status: OfferStatusEnum.ACTIVE } as any,
      });
      await this.syncProductDiscountedPrice(offer.productId.toString());
    }

    const activeToExpireds = await this.offerRepository.findMany({
      filters: {
        status: OfferStatusEnum.ACTIVE,
        endDate: { $lte: now },
        isDeleted: false,
      },
    });

    for (const offer of activeToExpireds) {
      await this.offerRepository.update({
        filters: { _id: offer._id },
        body: { status: OfferStatusEnum.EXPIRED } as any,
      });
      await this.syncProductDiscountedPrice(offer.productId.toString());
    }
  }
}
