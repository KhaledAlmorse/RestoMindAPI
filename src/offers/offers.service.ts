import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { isValidObjectId, Types } from 'mongoose';
import {
  OfferRepository,
  ProductRepository,
  RestaurantRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { QueryOfferDto } from './dto/query-offer.dto';
import { OfferStatusEnum, OfferSourceEnum } from 'src/Common/Types';

@Injectable()
export class OffersService implements OnModuleInit {
  constructor(
    private readonly offerRepository: OfferRepository,
    private readonly productRepository: ProductRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async onModuleInit() {
    await this.processStatusTransitions();
  }

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

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  private async getManagerRestaurantId(
    userId: string,
  ): Promise<Types.ObjectId> {
    this.validateObjectId(userId);
    const user = await this.userRepository.findOne({
      filters: { _id: new Types.ObjectId(userId), isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.restaurantId) {
      return new Types.ObjectId(user.restaurantId.toString());
    }

    const restaurant = await this.restaurantRepository.findOne({
      filters: { ownerUserId: new Types.ObjectId(userId), isDeleted: false },
    });

    if (!restaurant) {
      throw new ForbiddenException(
        'You are not assigned to a restaurant or do not own one',
      );
    }

    return restaurant._id;
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

  async createOffer(dto: CreateOfferDto, userId: string) {
    this.validateObjectId(dto.productId);

    const managerRestaurantId = await this.getManagerRestaurantId(userId);

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

    await this.checkOverlap(dto.productId);

    const startDate = this.parseStartDate(dto.startDate);
    const endDate = this.parseEndDate(dto.endDate);
    const now = new Date();

    if (startDate >= endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }
    if (endDate <= now) {
      throw new BadRequestException('endDate must be in the future');
    }

    let status = dto.status;
    if (!status) {
      const todayYMD = now.toISOString().split('T')[0];
      const startYMD = startDate.toISOString().split('T')[0];
      const isStartingTodayOrPast = startDate <= now || startYMD <= todayYMD;
      status = isStartingTodayOrPast
        ? OfferStatusEnum.ACTIVE
        : OfferStatusEnum.SCHEDULED;
    }

    const originalPrice = product.price;
    const offerPrice =
      Math.round(originalPrice * (1 - dto.discountPercentage / 100) * 100) /
      100;
    const availableQuantity = dto.availableQuantity;
    const remainingQuantity = dto.availableQuantity;
    const maxPerCustomer = dto.maxPerCustomer ?? null;

    const offer = await this.offerRepository.create({
      productId: new Types.ObjectId(dto.productId),
      restaurantId: managerRestaurantId,
      originalPrice,
      offerPrice,
      discountPercentage: dto.discountPercentage,
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

  async getOffers(query: QueryOfferDto, userId: string) {
    const {
      status,
      productId,
      source,
      categoryId,
      restaurantId,
      search,
      featured,
      minPrice,
      maxPrice,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = '1',
      limit = '10',
    } = query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const skip = (pageNum - 1) * limitNum;

    const managerRestaurantId = await this.getManagerRestaurantId(userId);

    const filters: Record<string, any> = {
      restaurantId: managerRestaurantId,
      isDeleted: false,
    };

    if (status) {
      filters.status = status;
    }

    if (productId) {
      this.validateObjectId(productId);
      filters.productId = new Types.ObjectId(productId);
    }

    if (source) {
      filters.source = source;
    }

    if (featured !== undefined) {
      filters.featured = featured === 'true' || (featured as any) === true;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      filters.offerPrice = {};
      if (minPrice !== undefined) {
        filters.offerPrice.$gte = parseFloat(minPrice);
      }
      if (maxPrice !== undefined) {
        filters.offerPrice.$lte = parseFloat(maxPrice);
      }
    }

    if (query.startDate) {
      filters.startDate = { $gte: this.parseStartDate(query.startDate) };
    }

    if (query.endDate) {
      filters.endDate = { $lte: this.parseEndDate(query.endDate) };
    }

    const populationArray: any[] = [
      { path: 'productId', populate: { path: 'category' } },
      { path: 'restaurantId' },
    ];

    let offers =
      (await this.offerRepository.findMany({
        filters,
        populationArray,
      })) || [];

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      offers = offers.filter((off: any) => {
        const prod = off.productId;
        return (
          prod &&
          (searchRegex.test(prod.title || '') ||
            searchRegex.test(prod.description || ''))
        );
      });
    }

    if (categoryId) {
      this.validateObjectId(categoryId);
      offers = offers.filter((off: any) => {
        const prod = off.productId;
        if (!prod || !prod.category) return false;
        const catId = prod.category._id
          ? prod.category._id.toString()
          : prod.category.toString();
        return catId === categoryId;
      });
    }

    const sortMultiplier = sortOrder === 'asc' ? 1 : -1;
    offers.sort((a: any, b: any) => {
      let valA = a[sortBy] ?? a.createdAt;
      let valB = b[sortBy] ?? b.createdAt;
      if (valA instanceof Date) valA = valA.getTime();
      if (valB instanceof Date) valB = valB.getTime();
      if (valA < valB) return -1 * sortMultiplier;
      if (valA > valB) return 1 * sortMultiplier;
      return 0;
    });

    const total = offers.length;
    const items = offers.slice(skip, skip + limitNum);

    return {
      items,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  async getOfferById(idOrSlug: string, userId: string) {
    const managerRestaurantId = await this.getManagerRestaurantId(userId);
    let offer: any = null;

    if (isValidObjectId(idOrSlug)) {
      offer = await this.offerRepository.findOne({
        filters: { _id: new Types.ObjectId(idOrSlug), isDeleted: false },
        populationArray: [
          { path: 'productId' },
          { path: 'createdBy', select: 'firstName lastName email' },
        ],
      });
    }

    if (!offer) {
      let product: any = null;
      if (isValidObjectId(idOrSlug)) {
        product = await this.productRepository.findOne({
          filters: { _id: new Types.ObjectId(idOrSlug), isDeleted: false },
        });
      }
      if (!product) {
        product = await this.productRepository.findOne({
          filters: { slug: idOrSlug, isDeleted: false },
        });
      }

      if (product) {
        offer = await this.offerRepository.findOne({
          filters: { productId: product._id, isDeleted: false },
          populationArray: [
            { path: 'productId' },
            { path: 'createdBy', select: 'firstName lastName email' },
          ],
        });
      }
    }

    if (!offer) {
      throw new NotFoundException('Offer not found');
    }

    if (offer.restaurantId.toString() !== managerRestaurantId.toString()) {
      throw new ForbiddenException(
        'You can only access offers belonging to your restaurant',
      );
    }

    return { data: offer };
  }

  async updateOffer(id: string, dto: UpdateOfferDto, userId: string) {
    const managerRestaurantId = await this.getManagerRestaurantId(userId);
    this.validateObjectId(id);

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
        filters: { _id: new Types.ObjectId(dto.productId), isDeleted: false },
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }
      if (product.restaurantId.toString() !== managerRestaurantId.toString()) {
        throw new ForbiddenException(
          'Product does not belong to your restaurant',
        );
      }
      await this.checkOverlap(dto.productId, id);
      updateBody.productId = new Types.ObjectId(dto.productId);
      updateBody.restaurantId = product.restaurantId;
    }

    if (dto.startDate || dto.endDate) {
      const effectiveStartDate = dto.startDate
        ? this.parseStartDate(dto.startDate)
        : new Date(offer.startDate);
      const effectiveEndDate = dto.endDate
        ? this.parseEndDate(dto.endDate)
        : new Date(offer.endDate);
      const now = new Date();

      if (effectiveStartDate >= effectiveEndDate) {
        throw new BadRequestException('startDate must be before endDate');
      }
      if (effectiveEndDate <= now) {
        throw new BadRequestException('endDate must be in the future');
      }

      if (dto.startDate) updateBody.startDate = effectiveStartDate;
      if (dto.endDate) updateBody.endDate = effectiveEndDate;

      const todayYMD = now.toISOString().split('T')[0];
      const startYMD = effectiveStartDate.toISOString().split('T')[0];
      if (effectiveStartDate <= now || startYMD <= todayYMD) {
        updateBody.status = OfferStatusEnum.ACTIVE;
      } else {
        updateBody.status = OfferStatusEnum.SCHEDULED;
      }
    }

    const updated = await this.offerRepository.update({
      filters: { _id: new Types.ObjectId(id) },
      body: updateBody,
    });

    return { data: updated };
  }

  async cancelOffer(id: string, userId: string) {
    const managerRestaurantId = await this.getManagerRestaurantId(userId);
    this.validateObjectId(id);

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

    await this.offerRepository.update({
      filters: { _id: new Types.ObjectId(id) },
      body: { status: OfferStatusEnum.CANCELLED } as any,
    });

    const updated = await this.offerRepository.findOne({
      filters: { _id: new Types.ObjectId(id) },
    });
    return { data: updated };
  }

  async getActiveOffers(query: QueryOfferDto) {
    const {
      productId,
      restaurantId,
      categoryId,
      source,
      search,
      featured,
      minPrice,
      maxPrice,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = '1',
      limit = '10',
    } = query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const skip = (pageNum - 1) * limitNum;

    const now = new Date();
    const filters: Record<string, any> = {
      status: OfferStatusEnum.ACTIVE,
      isDeleted: false,
      startDate: { $lte: now },
      endDate: { $gte: now },
    };

    if (query.startDate) {
      filters.startDate = {
        $gte: this.parseStartDate(query.startDate),
        $lte: now,
      };
    }

    if (query.endDate) {
      filters.endDate = {
        $lte: this.parseEndDate(query.endDate),
        $gte: now,
      };
    }

    if (productId) {
      this.validateObjectId(productId);
      filters.productId = new Types.ObjectId(productId);
    }

    if (restaurantId) {
      this.validateObjectId(restaurantId);
      filters.restaurantId = new Types.ObjectId(restaurantId);
    }

    if (source) {
      filters.source = source;
    }

    if (featured !== undefined) {
      filters.featured = featured === 'true' || (featured as any) === true;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      filters.offerPrice = {};
      if (minPrice !== undefined) {
        filters.offerPrice.$gte = parseFloat(minPrice);
      }
      if (maxPrice !== undefined) {
        filters.offerPrice.$lte = parseFloat(maxPrice);
      }
    }

    const populationArray: any[] = [
      {
        path: 'productId',
        populate: { path: 'category' },
        select: 'title description price image category slug isAvailable',
      },
      {
        path: 'restaurantId',
        select: 'name description phone address isActive isDeleted',
      },
    ];

    let offers =
      (await this.offerRepository.findMany({
        filters,
        populationArray,
      })) || [];

    // Filter out offers whose restaurant is inactive or soft deleted
    offers = offers.filter(
      (off: any) =>
        off.restaurantId &&
        off.restaurantId.isActive !== false &&
        !off.restaurantId.isDeleted,
    );

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      offers = offers.filter((off: any) => {
        const prod = off.productId;
        return (
          prod &&
          (searchRegex.test(prod.title || '') ||
            searchRegex.test(prod.description || ''))
        );
      });
    }

    if (categoryId) {
      this.validateObjectId(categoryId);
      offers = offers.filter((off: any) => {
        const prod = off.productId;
        if (!prod || !prod.category) return false;
        const catId = prod.category._id
          ? prod.category._id.toString()
          : prod.category.toString();
        return catId === categoryId;
      });
    }

    const sortMultiplier = sortOrder === 'asc' ? 1 : -1;
    offers.sort((a: any, b: any) => {
      let valA = a[sortBy] ?? a.createdAt;
      let valB = b[sortBy] ?? b.createdAt;
      if (valA instanceof Date) valA = valA.getTime();
      if (valB instanceof Date) valB = valB.getTime();
      if (valA < valB) return -1 * sortMultiplier;
      if (valA > valB) return 1 * sortMultiplier;
      return 0;
    });

    const total = offers.length;
    const items = offers.slice(skip, skip + limitNum);

    if (items.length === 0) {
      throw new NotFoundException('No active offers found');
    }

    return {
      items,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  async getRecommendedOffers(query: QueryOfferDto) {
    const {
      categoryId,
      restaurantId,
      search,
      minPrice,
      maxPrice,
      page = '1',
      limit = '10',
    } = query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const skip = (pageNum - 1) * limitNum;

    const now = new Date();

    const filters: Record<string, any> = {
      status: OfferStatusEnum.ACTIVE,
      isDeleted: false,
      startDate: { $lte: now },
      endDate: { $gte: now },
      remainingQuantity: { $gt: 0 },
    };

    if (restaurantId) {
      this.validateObjectId(restaurantId);
      filters.restaurantId = new Types.ObjectId(restaurantId);
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      filters.offerPrice = {};
      if (minPrice !== undefined) {
        filters.offerPrice.$gte = parseFloat(minPrice);
      }
      if (maxPrice !== undefined) {
        filters.offerPrice.$lte = parseFloat(maxPrice);
      }
    }

    // Recommendation sort pushed to MongoDB
    const sort: Record<string, 1 | -1> = {
      featured: -1,
      discountPercentage: -1,
      endDate: 1,
      availableQuantity: -1,
      createdAt: -1,
    };

    // Same population as getActiveOffers for identical response shape
    const populationArray: any[] = [
      {
        path: 'productId',
        populate: { path: 'category' },
        select: 'title description price image category slug isAvailable',
      },
      {
        path: 'restaurantId',
        select: 'name description phone address isActive isDeleted',
      },
    ];

    const needsInMemoryFilter = true;

    if (!needsInMemoryFilter) {
      // Fast path: MongoDB handles sort + pagination + count
      const { items, total } = await this.offerRepository.findManySorted({
        filters,
        sort,
        skip,
        limit: limitNum,
        populationArray,
      });

      return {
        items,
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      };
    }

    // Slow path: search/categoryId depend on populated Product fields,
    // so we let MongoDB sort but must filter + paginate in memory.
    const { items: allSorted } = await this.offerRepository.findManySorted({
      filters,
      sort,
      skip: 0,
      limit: 0, // 0 = no limit in Mongoose, returns all matching docs
      populationArray,
    });

    let offers = allSorted || [];

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      offers = offers.filter((off: any) => {
        const prod = off.productId;
        return (
          prod &&
          (searchRegex.test(prod.title || '') ||
            searchRegex.test(prod.description || ''))
        );
      });
    }

    if (categoryId) {
      this.validateObjectId(categoryId);
      offers = offers.filter((off: any) => {
        const prod = off.productId;
        if (!prod || !prod.category) return false;
        const catId = prod.category._id
          ? prod.category._id.toString()
          : prod.category.toString();
        return catId === categoryId;
      });
    }

    // Filter out offers whose restaurant is inactive or soft deleted
    offers = offers.filter(
      (off: any) =>
        off.restaurantId &&
        off.restaurantId.isActive !== false &&
        !off.restaurantId.isDeleted,
    );

    const total = offers.length;
    const items = offers.slice(skip, skip + limitNum);

    return {
      items,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  async getActiveOfferById(idOrSlug: string) {
    const now = new Date();
    let offer: any = null;

    const populationArray: any[] = [
      {
        path: 'productId',
        select: 'title description price image category slug isAvailable',
      },
      {
        path: 'restaurantId',
        select: 'name description phone address isActive isDeleted',
      },
    ];

    if (isValidObjectId(idOrSlug)) {
      offer = await this.offerRepository.findOne({
        filters: {
          _id: new Types.ObjectId(idOrSlug),
          status: OfferStatusEnum.ACTIVE,
          isDeleted: false,
          startDate: { $lte: now },
          endDate: { $gte: now },
        },
        select: '-createdBy -isDeleted -updatedAt -__v',
        populationArray,
      });
    }

    if (!offer) {
      let product: any = null;
      if (isValidObjectId(idOrSlug)) {
        product = await this.productRepository.findOne({
          filters: { _id: new Types.ObjectId(idOrSlug), isDeleted: false },
        });
      }
      if (!product) {
        product = await this.productRepository.findOne({
          filters: { slug: idOrSlug, isDeleted: false },
        });
      }

      if (product) {
        offer = await this.offerRepository.findOne({
          filters: {
            productId: product._id,
            status: OfferStatusEnum.ACTIVE,
            isDeleted: false,
            startDate: { $lte: now },
            endDate: { $gte: now },
          },
          select: '-createdBy -isDeleted -updatedAt -__v',
          populationArray,
        });
      }
    }

    if (
      !offer ||
      !offer.restaurantId ||
      offer.restaurantId.isActive === false ||
      offer.restaurantId.isDeleted
    ) {
      throw new NotFoundException('Active offer not found');
    }

    return { data: offer };
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
    }

    const activeToScheduleds = await this.offerRepository.findMany({
      filters: {
        status: OfferStatusEnum.ACTIVE,
        startDate: { $gt: now },
        isDeleted: false,
      },
    });

    for (const offer of activeToScheduleds) {
      await this.offerRepository.update({
        filters: { _id: offer._id },
        body: { status: OfferStatusEnum.SCHEDULED } as any,
      });
    }
  }
}
