import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Types } from 'mongoose';
import {
  OrderRepository,
  OrderGroupRepository,
  CartRepository,
  ProductRepository,
  UserRepository,
  RestaurantRepository,
  OfferRepository,
  SalesTransactionRepository,
} from 'src/DB/Repositories';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryRestaurantOrdersDto } from './dto/query-restaurant-orders.dto';
import { QueryOrderListingDto } from './dto/query-order-listing.dto';
import { QueryMyOrdersDto } from './dto/query-my-orders.dto';
import { Decrypt } from 'src/Common/Security';
import { OfferStatusEnum, RolesEnum, SalesSourceEnum } from 'src/Common/Types';
import { UserType } from 'src/DB/Models';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly orderGroupRepository: OrderGroupRepository,
    private readonly cartRepository: CartRepository,
    private readonly productRepository: ProductRepository,
    private readonly userRepository: UserRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly offerRepository: OfferRepository,
    private readonly salesTransactionRepository: SalesTransactionRepository,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  private computeOverallStatus(childOrders: any[]): string {
    if (!childOrders || childOrders.length === 0) return 'Pending';
    const statuses = childOrders.map((o) => o.status);

    const allCancelled = statuses.every((s) => s === 'Cancelled');
    if (allCancelled) return 'Cancelled';

    const firstStatus = statuses[0];
    const allSame = statuses.every((s) => s === firstStatus);
    if (allSame) return firstStatus;

    const hasDelivered = statuses.some((s) => s === 'Delivered');
    if (hasDelivered) return 'Partially Delivered';

    const hasCancelled = statuses.some((s) => s === 'Cancelled');
    if (hasCancelled) return 'Partially Cancelled';

    return 'Processing';
  }

  private async formatOrderGroup(group: any, managerRestaurantId?: string) {
    let childOrders = group.orderIds || group.restaurantOrderIds || [];

    const isUnpopulated =
      !childOrders.length ||
      childOrders.some(
        (sub: any) =>
          !sub ||
          typeof sub !== 'object' ||
          !sub._id ||
          typeof sub.status === 'undefined',
      );

    if (isUnpopulated && group._id) {
      const fetchedChildOrders = await this.orderRepository.findMany({
        filters: { groupOrderId: group._id },
        populationArray: [{ path: 'restaurantId' }],
      });
      if (fetchedChildOrders && fetchedChildOrders.length > 0) {
        childOrders = fetchedChildOrders;
      }
    }

    if (managerRestaurantId) {
      childOrders = childOrders.filter((sub: any) => {
        const restId = sub?.restaurantId?._id
          ? sub.restaurantId._id.toString()
          : sub?.restaurantId?.toString() || sub?.restaurantId;
        return restId === managerRestaurantId;
      });
    }

    const overallStatus = this.computeOverallStatus(childOrders);

    const validChildOrders = childOrders.filter(
      (sub: any) => sub && typeof sub === 'object' && sub._id,
    );

    const allItems: any[] = [];
    let computedOriginalPrice = 0;
    let computedDiscount = 0;
    let computedTotalPrice = 0;
    let computedQuantity = 0;

    for (const sub of validChildOrders) {
      const restaurant = sub.restaurantId;
      const subRestaurantId = restaurant?._id
        ? restaurant._id.toString()
        : restaurant?.toString() || '';
      const subRestaurantName =
        restaurant?.name ||
        restaurant?.restaurantName ||
        restaurant?.title ||
        sub.restaurantName ||
        '';

      for (const item of sub.items || []) {
        const itemRestId = item.restaurantId?._id
          ? item.restaurantId._id.toString()
          : item.restaurantId?.toString() || subRestaurantId;
        const itemRestName =
          item.restaurantName || subRestaurantName || '';

        const origPrice = item.originalPrice ?? item.price ?? 0;
        const offPrice = item.offerPrice ?? item.discountedPrice ?? 0;
        const qty = item.quantity ?? 1;
        const lineTot = item.lineTotal ?? offPrice * qty;
        const discPct = item.discountPercentage ?? 0;

        allItems.push({
          offerId: item.offerId?._id
            ? item.offerId._id.toString()
            : item.offerId?.toString() || item.offerId,
          productId: item.productId?._id
            ? item.productId._id.toString()
            : item.productId?.toString() || item.productId,
          productTitle: item.productTitle || item.title || '',
          productImage: item.productImage || '',
          restaurantId: itemRestId,
          restaurantName: itemRestName,
          originalPrice: origPrice,
          offerPrice: offPrice,
          discountPercentage: discPct,
          quantity: qty,
          purchasedAt: item.purchasedAt || sub.createdAt || group.createdAt,
          lineTotal: lineTot,
        });

        computedOriginalPrice += origPrice * qty;
        computedDiscount += Math.max(0, (origPrice - offPrice) * qty);
        computedTotalPrice += lineTot;
        computedQuantity += qty;
      }
    }

    let formattedUserId: any = group.userId;
    if (
      group.userId &&
      typeof group.userId === 'object' &&
      (group.userId._id || group.userId.firstName || group.userId.email)
    ) {
      const userObj = group.userId.toObject
        ? group.userId.toObject()
        : { ...group.userId };
      delete userObj.password;
      if (userObj._id) {
        userObj.id = userObj._id.toString();
      }
      formattedUserId = userObj;
    } else if (group.userId?._id) {
      formattedUserId = group.userId._id.toString();
    } else if (group.userId) {
      formattedUserId = group.userId.toString();
    }

    const totalOriginalPrice = allItems.length
      ? computedOriginalPrice
      : (group.totalOriginalPrice ?? 0);
    const totalDiscount = allItems.length
      ? computedDiscount
      : (group.totalDiscount ?? 0);
    const finalTotalPrice = allItems.length
      ? computedTotalPrice
      : (group.finalTotalPrice ?? 0);
    const totalQuantity = allItems.length
      ? computedQuantity
      : (group.totalQuantity ?? 0);

    return {
      _id: group._id.toString(),
      groupOrderId: group._id.toString(),
      orderGroupId: group._id.toString(),
      userId: formattedUserId,
      fullName: group.fullName,
      phoneNumber: group.phoneNumber,
      emailAddress: group.emailAddress,
      deliveryMethod: group.deliveryMethod,
      deliveryAddress: group.deliveryAddress,
      paymentMethod: group.paymentMethod,
      specialNotes: group.specialNotes,
      overallStatus,
      items: allItems,
      totalOriginalPrice,
      totalDiscount,
      finalTotalPrice,
      totalQuantity,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt || group.createdAt,
    };
  }

  private async runTransaction<T>(
    work: (session: any) => Promise<T>,
  ): Promise<T> {
    let session: any = null;
    try {
      session = await this.connection.startSession();
      session.startTransaction();
      const result = await work(session);
      await session.commitTransaction();
      return result;
    } catch (err: any) {
      if (session) {
        try {
          await session.abortTransaction();
        } catch (_) {
          //*
        }
      }
      if (
        err?.message?.includes('Transaction numbers are only allowed') ||
        err?.message?.includes('replica set')
      ) {
        return await work(null);
      }
      throw err;
    } finally {
      if (session) {
        try {
          await session.endSession();
        } catch (_) {
          //*
        }
      }
    }
  }

  async createOrder(userId: string, body: CreateOrderDto) {
    const dbUser = await this.userRepository.findOne({
      filters: { _id: userId },
    });
    if (!dbUser) {
      throw new NotFoundException('User not found');
    }

    const fullName = `${dbUser.firstName} ${dbUser.lastName}`.trim();

    let userPhone = dbUser.phone;
    try {
      userPhone = Decrypt(
        dbUser.phone,
        process.env.Encryption_SECRET as string,
      );
    } catch (e) {
      // fallback
    }

    const userObjId = new Types.ObjectId(userId);
    const cart = await this.cartRepository.findOne({
      filters: {
        $or: [{ userId: userObjId }, { userId }],
      },
    });

    if (!cart || !cart.items || cart.items.length === 0) {
      throw new BadRequestException('Your cart is empty');
    }

    // Resolve address snapshot if Home Delivery
    let resolvedAddress: any = null;
    if (body.deliveryMethod === 'Home Delivery') {
      if (body.deliveryAddress.addressId) {
        const savedAddress = dbUser.addresses.find(
          (addr) => addr._id.toString() === body.deliveryAddress.addressId,
        );
        if (!savedAddress) {
          throw new BadRequestException('Saved address not found');
        }
        resolvedAddress = {
          addressId: savedAddress._id.toString(),
          street: savedAddress.street,
          city: savedAddress.city,
          country: savedAddress.country || '',
        };
      } else {
        resolvedAddress = {
          street: body.deliveryAddress.street,
          city: body.deliveryAddress.city,
          country: body.deliveryAddress.country,
        };
        if (body.saveAddress) {
          const isDefault = dbUser.addresses.length === 0;
          const newAddr = {
            _id: new Types.ObjectId(),
            fullName: fullName,
            phoneNumber: userPhone,
            street: body.deliveryAddress.street,
            city: body.deliveryAddress.city,
            country: body.deliveryAddress.country,
            label: 'Saved Address',
            isDefault,
          };
          dbUser.addresses.push(newAddr as any);
          await this.userRepository.update({
            filters: { _id: userId },
            body: { addresses: dbUser.addresses } as any,
          });
        }
      }
    }

    // Pre-validate all cart items against live offers loaded directly from DB
    const now = new Date();
    const validatedCartEntries: {
      item: any;
      offer: any;
      product: any;
      restaurant: any;
    }[] = [];

    for (const item of cart.items) {
      const rawOfferId = item.offerId?._id ? item.offerId._id : item.offerId;

      const offer = await this.offerRepository.findOne({
        filters: { _id: new Types.ObjectId(rawOfferId), isDeleted: false },
        populationArray: [{ path: 'productId' }, { path: 'restaurantId' }],
      });

      if (!offer) {
        throw new BadRequestException(
          'One or more offers in your cart are no longer available',
        );
      }

      const product = offer.productId as any;
      const restaurant = offer.restaurantId as any;

      if (!product || product.isDeleted) {
        throw new BadRequestException(
          `Product for offer "${offer._id.toString()}" is no longer available`,
        );
      }

      if (offer.status !== OfferStatusEnum.ACTIVE) {
        throw new BadRequestException(
          `Offer for "${product.title || 'product'}" is ${offer.status}`,
        );
      }
      if (now < offer.startDate || now > offer.endDate) {
        throw new BadRequestException(
          `Offer for "${product.title || 'product'}" is outside its active period`,
        );
      }
      if (offer.remainingQuantity <= 0) {
        throw new BadRequestException(
          `Offer for "${product.title || 'product'}" is sold out`,
        );
      }
      if (offer.remainingQuantity < item.quantity) {
        throw new BadRequestException(
          `Only ${offer.remainingQuantity} left in stock for "${product.title || 'offer'}"`,
        );
      }

      if (offer.maxPerCustomer && offer.maxPerCustomer > 0) {
        const pastOrders = await this.orderRepository.findMany({
          filters: {
            userId: userObjId,
            status: { $ne: 'Cancelled' },
            'items.offerId': offer._id,
          },
        });
        let pastQuantity = 0;
        for (const ord of pastOrders || []) {
          for (const ordItem of ord.items || []) {
            if (ordItem.offerId?.toString() === offer._id.toString()) {
              pastQuantity += ordItem.quantity;
            }
          }
        }
        if (pastQuantity + item.quantity > offer.maxPerCustomer) {
          throw new BadRequestException(
            `You've reached the purchase limit for offer "${product.title || 'offer'}"`,
          );
        }
      }

      validatedCartEntries.push({ item, offer, product, restaurant });
    }

    // Group cart items by restaurantId
    const restaurantGroups = new Map<string, typeof validatedCartEntries>();
    for (const entry of validatedCartEntries) {
      const restId = (
        entry.restaurant?._id || entry.offer.restaurantId
      ).toString();

      if (!restaurantGroups.has(restId)) {
        restaurantGroups.set(restId, []);
      }
      restaurantGroups.get(restId)!.push(entry);
    }

    const groupOrderId = new Types.ObjectId();
    const createdOrderIds: Types.ObjectId[] = [];
    let groupTotalOriginalPrice = 0;
    let groupTotalDiscount = 0;
    let groupFinalTotalPrice = 0;
    let groupTotalQuantity = 0;
    const purchasedAt = new Date();

    await this.runTransaction(async (_session) => {
      for (const [restaurantId, entries] of restaurantGroups.entries()) {
        const orderItems: any[] = [];
        let totalQuantity = 0;
        let totalOriginalPrice = 0;
        let finalTotalPrice = 0;

        let restaurantName = '';

        for (const { item, offer, product, restaurant } of entries) {
          if (!restaurantName) {
            restaurantName =
              restaurant?.name ||
              restaurant?.restaurantName ||
              restaurant?.title ||
              '';
          }

          const quantity = item.quantity;
          const originalPrice =
            Number(offer.originalPrice) || Number(product.price) || 0;
          const offerPrice = Number(offer.offerPrice) || originalPrice;
          const discountPercentage = Number(offer.discountPercentage) || 0;
          const lineTotal = offerPrice * quantity;

          const productImage =
            product?.image?.secure_url || product?.image?.url || '';

          orderItems.push({
            offerId: offer._id,
            productId: product._id,
            productTitle: product.title,
            productImage,
            restaurantId: new Types.ObjectId(restaurantId),
            restaurantName,
            originalPrice,
            offerPrice,
            discountPercentage,
            quantity,
            purchasedAt,
            lineTotal,
          });

          totalQuantity += quantity;
          totalOriginalPrice += originalPrice * quantity;
          finalTotalPrice += lineTotal;

          // Atomic inventory reservation
          const updateResult = await this.offerRepository.update({
            filters: {
              _id: offer._id,
              remainingQuantity: { $gte: quantity },
            },
            body: {
              $inc: { remainingQuantity: -quantity },
            } as any,
          });

          if (!updateResult) {
            throw new BadRequestException(
              `Insufficient stock left for offer "${product.title}"`,
            );
          }

          // Check if offer became sold_out
          const updatedOffer = await this.offerRepository.findOne({
            filters: { _id: offer._id },
          });
          if (updatedOffer && updatedOffer.remainingQuantity === 0) {
            await this.offerRepository.update({
              filters: { _id: offer._id },
              body: { status: OfferStatusEnum.SOLD_OUT } as any,
            });
          }

          // AI recommendation feedback
          if (offer.recommendationId) {
            await this.offerRepository.update({
              filters: { _id: offer._id },
              body: {
                $inc: {
                  actualUnitsSold: quantity,
                  actualRevenueRecovered: lineTotal,
                },
              } as any,
            });
          }
        }

        const totalDiscount = totalOriginalPrice - finalTotalPrice;

        groupTotalQuantity += totalQuantity;
        groupTotalOriginalPrice += totalOriginalPrice;
        groupFinalTotalPrice += finalTotalPrice;
        groupTotalDiscount += totalDiscount;

        const newOrder = await this.orderRepository.create({
          groupOrderId,
          userId: new Types.ObjectId(userId),
          restaurantId: new Types.ObjectId(restaurantId),
          items: orderItems,
          totalOriginalPrice,
          totalDiscount,
          finalTotalPrice,
          totalQuantity,
          fullName,
          phoneNumber: userPhone,
          emailAddress: dbUser.email,
          deliveryMethod: body.deliveryMethod,
          deliveryAddress: resolvedAddress,
          specialNotes: body.specialNotes,
          paymentMethod: body.paymentMethod,
          status: 'Pending',
        });

        createdOrderIds.push(newOrder._id);
      }

      await this.orderGroupRepository.create({
        _id: groupOrderId,
        userId: new Types.ObjectId(userId),
        orderIds: createdOrderIds,
        fullName,
        phoneNumber: userPhone,
        emailAddress: dbUser.email,
        deliveryMethod: body.deliveryMethod,
        deliveryAddress: resolvedAddress,
        specialNotes: body.specialNotes,
        paymentMethod: body.paymentMethod,
        totalOriginalPrice: groupTotalOriginalPrice,
        totalDiscount: groupTotalDiscount,
        finalTotalPrice: groupFinalTotalPrice,
        totalQuantity: groupTotalQuantity,
        overallStatus: 'Pending',
      });
    });

    // Clear customer's cart after successful order creation
    cart.items = [];
    await this.cartRepository.save(cart);

    const populatedGroup = await this.orderGroupRepository.findOne({
      filters: { _id: groupOrderId },
      populationArray: [
        {
          path: 'orderIds',
          populate: [{ path: 'restaurantId' }],
        },
      ],
    });

    return { data: await this.formatOrderGroup(populatedGroup) };
  }

  async getMyOrders(userId: string, query: QueryMyOrdersDto | string = {}) {
    this.validateObjectId(userId);

    const queryObj: QueryMyOrdersDto =
      typeof query === 'string' ? { restaurantId: query } : query;

    const currentPage = Math.max(1, Number(queryObj.page) || 1);
    const pageSize = Math.max(1, Number(queryObj.limit) || 10);
    const skip = (currentPage - 1) * pageSize;
    const status = queryObj.status;
    const restaurantId = queryObj.restaurantId;

    const userObjId = new Types.ObjectId(userId);
    const userFilter = { $or: [{ userId: userObjId }, { userId }] };

    let groupFilters: any = userFilter;

    if (
      (restaurantId && restaurantId !== 'undefined' && restaurantId !== '') ||
      status
    ) {
      const orderFilters: Record<string, any> = {
        $or: [{ userId: userObjId }, { userId }],
      };

      if (restaurantId && restaurantId !== 'undefined' && restaurantId !== '') {
        this.validateObjectId(restaurantId);
        orderFilters.restaurantId = new Types.ObjectId(restaurantId);
      }

      if (status) {
        orderFilters.status = status;
      }

      const matchingOrders = await this.orderRepository.findMany({
        filters: orderFilters,
        select: 'groupOrderId',
      });

      const matchingGroupIdsFromOrders = (matchingOrders || [])
        .map((o: any) => o.groupOrderId?.toString())
        .filter(Boolean);

      let matchingGroupIdsDirect: string[] = [];
      if (status) {
        const directGroups = await this.orderGroupRepository.findMany({
          filters: { ...userFilter, overallStatus: status },
          select: '_id',
        });
        matchingGroupIdsDirect = (directGroups || []).map((g: any) =>
          g._id.toString(),
        );
      }

      const allMatchingGroupIds = Array.from(
        new Set([...matchingGroupIdsFromOrders, ...matchingGroupIdsDirect]),
      ).map((id) => new Types.ObjectId(id));

      groupFilters = {
        $and: [userFilter, { _id: { $in: allMatchingGroupIds } }],
      };
    }

    const paginatedResult = await this.orderGroupRepository.findManyPaginated({
      filters: groupFilters,
      skip,
      limit: pageSize,
      sort: 'createdAt',
      order: 'desc',
      populationArray: [
        {
          path: 'orderIds',
          populate: [{ path: 'restaurantId' }],
        },
      ],
    });

    const totalItems = paginatedResult.total;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const hasNextPage = currentPage < totalPages;
    const hasPreviousPage = currentPage > 1;

    const formattedGroups = await Promise.all(
      (paginatedResult.items || []).map((g) => this.formatOrderGroup(g)),
    );

    return {
      data: formattedGroups,
      totalItems,
      totalPages,
      currentPage,
      pageSize,
      hasNextPage,
      hasPreviousPage,
    };
  }

  async getMyOrderDetails(userId: string, id: string) {
    this.validateObjectId(userId);
    this.validateObjectId(id);

    const userObjId = new Types.ObjectId(userId);
    const targetId = new Types.ObjectId(id);

    // 1. Try lookup by orderGroupId
    let group = await this.orderGroupRepository.findOne({
      filters: {
        _id: targetId,
        userId: userObjId,
      },
      populationArray: [
        {
          path: 'orderIds',
          populate: [{ path: 'restaurantId' }],
        },
      ],
    });

    // 2. Fallback lookup by child orderId
    if (!group) {
      group = await this.orderGroupRepository.findOne({
        filters: {
          userId: userObjId,
          orderIds: targetId,
        },
        populationArray: [
          {
            path: 'orderIds',
            populate: [{ path: 'restaurantId' }],
          },
        ],
      });
    }

    if (!group) {
      throw new NotFoundException('Checkout details not found');
    }

    return { data: await this.formatOrderGroup(group) };
  }

  async getOrderGroupById(id: string, currentUser?: UserType | string) {
    this.validateObjectId(id);
    const targetId = new Types.ObjectId(id);

    const filters: any = {
      $or: [{ _id: targetId }, { orderIds: targetId }],
    };

    let userObj: UserType | null = null;
    if (typeof currentUser === 'string') {
      this.validateObjectId(currentUser);
      filters.userId = new Types.ObjectId(currentUser);
    } else if (currentUser && typeof currentUser === 'object') {
      userObj = currentUser;
      if (currentUser.role === RolesEnum.CUSTOMER) {
        filters.userId = new Types.ObjectId(currentUser._id.toString());
      }
    }

    const group = await this.orderGroupRepository.findOne({
      filters,
      populationArray: [
        {
          path: 'orderIds',
          populate: [{ path: 'restaurantId' }],
        },
      ],
    });

    if (!group) {
      throw new NotFoundException('Checkout details not found');
    }

    if (userObj && userObj.role === RolesEnum.MANAGER) {
      if (!userObj.restaurantId) {
        throw new ForbiddenException('Manager is not assigned to a restaurant');
      }
      const managerRestId = userObj.restaurantId.toString();
      const childOrders = group.orderIds || [];
      const hasMatchingOrder = childOrders.some(
        (sub: any) =>
          sub &&
          (sub.restaurantId?._id?.toString() === managerRestId ||
            sub.restaurantId?.toString() === managerRestId),
      );
      if (!hasMatchingOrder) {
        throw new ForbiddenException(
          'You can only view orders belonging to your own restaurant',
        );
      }
      return { data: await this.formatOrderGroup(group, managerRestId) };
    }

    return { data: await this.formatOrderGroup(group) };
  }

  private buildOrderFilters(
    query: QueryOrderListingDto = {},
    overrideRestaurantId?: string,
  ) {
    const filters: Record<string, any> = {};

    const targetRestaurantId = overrideRestaurantId || query?.restaurantId;
    if (
      targetRestaurantId &&
      targetRestaurantId !== 'undefined' &&
      targetRestaurantId !== ''
    ) {
      this.validateObjectId(targetRestaurantId);
      filters.restaurantId = new Types.ObjectId(targetRestaurantId);
    }

    if (query?.status) {
      filters.status = query.status;
    }

    if (query?.paymentMethod) {
      filters.paymentMethod = query.paymentMethod;
    }

    if (query?.deliveryMethod) {
      filters.deliveryMethod = query.deliveryMethod;
    }

    if (query?.startDate || query?.endDate) {
      filters.createdAt = {};
      if (query.startDate) {
        const start = new Date(query.startDate);
        if (query.startDate.trim().length === 10) {
          start.setUTCHours(0, 0, 0, 0);
        }
        filters.createdAt.$gte = start;
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        if (query.endDate.trim().length === 10) {
          end.setUTCHours(23, 59, 59, 999);
        }
        filters.createdAt.$lte = end;
      }
    }

    if (
      query?.minTotalPrice !== undefined ||
      query?.maxTotalPrice !== undefined
    ) {
      filters.finalTotalPrice = {};
      if (query.minTotalPrice !== undefined) {
        filters.finalTotalPrice.$gte = Number(query.minTotalPrice);
      }
      if (query.maxTotalPrice !== undefined) {
        filters.finalTotalPrice.$lte = Number(query.maxTotalPrice);
      }
    }

    if (query?.search && query.search.trim() !== '') {
      const searchTerm = query.search.trim();
      const searchRegex = { $regex: searchTerm, $options: 'i' };

      const orConditions: any[] = [
        { fullName: searchRegex },
        { emailAddress: searchRegex },
        { phoneNumber: searchRegex },
      ];

      if (isValidObjectId(searchTerm)) {
        orConditions.push({ _id: new Types.ObjectId(searchTerm) });
        orConditions.push({ groupOrderId: new Types.ObjectId(searchTerm) });
      }

      filters.$or = orConditions;
    }

    return filters;
  }

  private async executePaginatedOrdersQuery(
    filters: Record<string, any>,
    query: QueryOrderListingDto = {},
  ) {
    const currentPage = Math.max(1, query.page || 1);
    const pageSize = Math.max(1, query.limit || 10);
    const skip = (currentPage - 1) * pageSize;

    const allowedSortFields = [
      'createdAt',
      'updatedAt',
      'finalTotalPrice',
      'totalQuantity',
      'status',
    ];
    let sortField = query.sortBy || query.sort || 'createdAt';
    if (!allowedSortFields.includes(sortField)) {
      sortField = 'createdAt';
    }

    const sortOrder = query.sortOrder || query.order || 'desc';

    const paginatedResult = await this.orderRepository.findManyPaginated({
      filters,
      skip,
      limit: pageSize,
      sort: sortField,
      order: sortOrder,
      populationArray: [
        { path: 'userId', select: '-password' },
        { path: 'restaurantId', select: '_id name title image logo' },
      ],
    });

    const totalItems = paginatedResult.total;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const hasNextPage = currentPage < totalPages;
    const hasPreviousPage = currentPage > 1;

    // Response optimization: lightweight restaurant projection
    const formattedData = paginatedResult.items.map((orderDoc: any) => {
      const orderObj = orderDoc.toObject
        ? orderDoc.toObject()
        : { ...orderDoc };
      const rest = orderObj.restaurantId;
      if (rest && typeof rest === 'object') {
        const restaurantObj: any = {
          _id: rest._id ? rest._id.toString() : rest.toString(),
          name: rest.name || rest.title || '',
        };
        if (rest.image) restaurantObj.image = rest.image;
        if (rest.logo) restaurantObj.logo = rest.logo;
        orderObj.restaurant = restaurantObj;
        delete orderObj.restaurantId;
      }
      return orderObj;
    });

    return {
      data: formattedData,
      totalItems,
      totalPages,
      currentPage,
      pageSize,
      hasNextPage,
      hasPreviousPage,
    };
  }

  async getAllOrders(query: QueryOrderListingDto = {}) {
    const currentPage = Math.max(1, query.page || 1);
    const pageSize = Math.max(1, query.limit || 10);
    const skip = (currentPage - 1) * pageSize;

    const filters: Record<string, any> = {};

    if (query.paymentMethod) {
      filters.paymentMethod = query.paymentMethod;
    }

    if (query.deliveryMethod) {
      filters.deliveryMethod = query.deliveryMethod;
    }

    if (query.status) {
      const matchingChildOrders = await this.orderRepository.findMany({
        filters: { status: query.status },
        select: 'groupOrderId',
      });
      const childGroupIds = (matchingChildOrders || [])
        .map((o: any) => o.groupOrderId?.toString())
        .filter(Boolean);

      filters.$or = [
        { overallStatus: query.status },
        { _id: { $in: childGroupIds.map((id) => new Types.ObjectId(id)) } },
      ];
    }

    if (
      query.restaurantId &&
      query.restaurantId !== 'undefined' &&
      query.restaurantId !== ''
    ) {
      this.validateObjectId(query.restaurantId);
      const matchingChildOrders = await this.orderRepository.findMany({
        filters: { restaurantId: new Types.ObjectId(query.restaurantId) },
        select: 'groupOrderId',
      });
      const groupIds = (matchingChildOrders || [])
        .map((o: any) => o.groupOrderId?.toString())
        .filter(Boolean);

      filters._id = { $in: groupIds.map((id) => new Types.ObjectId(id)) };
    }

    if (query.startDate || query.endDate) {
      filters.createdAt = {};
      if (query.startDate) {
        const start = new Date(query.startDate);
        if (query.startDate.trim().length === 10) {
          start.setUTCHours(0, 0, 0, 0);
        }
        filters.createdAt.$gte = start;
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        if (query.endDate.trim().length === 10) {
          end.setUTCHours(23, 59, 59, 999);
        }
        filters.createdAt.$lte = end;
      }
    }

    if (
      query.minTotalPrice !== undefined ||
      query.maxTotalPrice !== undefined
    ) {
      filters.finalTotalPrice = {};
      if (query.minTotalPrice !== undefined) {
        filters.finalTotalPrice.$gte = Number(query.minTotalPrice);
      }
      if (query.maxTotalPrice !== undefined) {
        filters.finalTotalPrice.$lte = Number(query.maxTotalPrice);
      }
    }

    if (query.search && query.search.trim() !== '') {
      const searchTerm = query.search.trim();
      const searchRegex = { $regex: searchTerm, $options: 'i' };

      const searchOr: any[] = [
        { fullName: searchRegex },
        { emailAddress: searchRegex },
        { phoneNumber: searchRegex },
      ];

      if (isValidObjectId(searchTerm)) {
        const objId = new Types.ObjectId(searchTerm);
        searchOr.push({ _id: objId });
        searchOr.push({ userId: objId });
        searchOr.push({ orderIds: objId });
      }

      if (filters.$or) {
        filters.$and = [{ $or: filters.$or }, { $or: searchOr }];
        delete filters.$or;
      } else {
        filters.$or = searchOr;
      }
    }

    const allowedSortFields = [
      'createdAt',
      'updatedAt',
      'finalTotalPrice',
      'totalQuantity',
      'overallStatus',
    ];
    let sortField = query.sortBy || query.sort || 'createdAt';
    if (!allowedSortFields.includes(sortField)) {
      sortField = 'createdAt';
    }

    const sortOrder = query.sortOrder || query.order || 'desc';

    const paginatedResult = await this.orderGroupRepository.findManyPaginated({
      filters,
      skip,
      limit: pageSize,
      sort: sortField,
      order: sortOrder,
      populationArray: [
        { path: 'userId', select: '-password' },
        {
          path: 'orderIds',
          populate: [{ path: 'restaurantId' }],
        },
      ],
    });

    const formattedData = await Promise.all(
      (paginatedResult.items || []).map((group) =>
        this.formatOrderGroup(group),
      ),
    );

    const totalItems = paginatedResult.total;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const hasNextPage = currentPage < totalPages;
    const hasPreviousPage = currentPage > 1;

    return {
      data: formattedData,
      totalItems,
      totalPages,
      currentPage,
      pageSize,
      hasNextPage,
      hasPreviousPage,
    };
  }

  async getRestaurantOrders(
    restaurantId: string,
    query: QueryOrderListingDto = {},
  ) {
    this.validateObjectId(restaurantId);
    const restaurant = await this.restaurantRepository.findOne({
      filters: { _id: restaurantId, isDeleted: false },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const filters = this.buildOrderFilters(query, restaurantId);
    return await this.executePaginatedOrdersQuery(filters, query);
  }

  async updateOrderStatus(id: string, status: string, currentUser?: UserType) {
    this.validateObjectId(id);
    const order = await this.orderRepository.findOne({ filters: { _id: id } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (currentUser && currentUser.role === RolesEnum.MANAGER) {
      if (
        !currentUser.restaurantId ||
        order.restaurantId.toString() !== currentUser.restaurantId.toString()
      ) {
        throw new ForbiddenException(
          'You can only update status of orders belonging to your own restaurant',
        );
      }
    }

    if (order.status === 'Delivered' || order.status === 'Cancelled') {
      throw new BadRequestException(
        `Cannot change status of a finalized order (${order.status})`,
      );
    }

    const updated = await this.orderRepository.update({
      filters: { _id: id },
      body: { status } as any,
    });

    // Sales History sync side effect if status transitions to Delivered
    if (status === 'Delivered') {
      try {
        for (const item of order.items || []) {
          let promotionActive = false;
          let featured = false;

          if (item.offerId) {
            const offerId = (item.offerId as any)._id || item.offerId;
            const offer = await this.offerRepository.findOne({
              filters: { _id: offerId },
            });
            if (offer) {
              promotionActive =
                offer.status === OfferStatusEnum.ACTIVE ||
                offer.discountPercentage > 0;
              featured = !!offer.featured;
            } else if (item.discountPercentage > 0) {
              promotionActive = true;
            }
          } else if (item.discountPercentage > 0) {
            promotionActive = true;
          }

          const existingTx = await this.salesTransactionRepository.findOne({
            filters: { orderId: order._id, productId: item.productId },
          });
          if (existingTx) {
            continue;
          }

          await this.salesTransactionRepository.create({
            restaurantId: order.restaurantId,
            productId: item.productId,
            date: item.purchasedAt || (order as any).createdAt || new Date(),
            quantitySold: item.quantity,
            basePrice: item.originalPrice,
            sellingPrice: item.offerPrice,
            promotionActive,
            featured,
            stockoutMinutes: 0,
            cancelledOrders: 0,
            returnedOrders: 0,
            salesChannel: 'marketplace',
            source: SalesSourceEnum.MARKETPLACE_ORDER,
            orderId: order._id,
          });
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to sync sales transaction for delivered order ${id}: ${err.message}`,
        );
      }
    }

    // Inventory restoration side effect if status transitions to Cancelled
    if (status === 'Cancelled') {
      const now = new Date();
      for (const item of order.items || []) {
        if (!item.offerId) continue;
        const offerId = item.offerId._id || item.offerId;
        const quantity = item.quantity;
        const lineTotal = item.lineTotal || 0;

        // Atomically increment remainingQuantity
        await this.offerRepository.update({
          filters: { _id: offerId },
          body: {
            $inc: { remainingQuantity: quantity },
          } as any,
        });

        // Reactivate offer if sold_out and within active date window
        const updatedOffer = await this.offerRepository.findOne({
          filters: { _id: offerId },
        });

        if (
          updatedOffer &&
          updatedOffer.status === OfferStatusEnum.SOLD_OUT &&
          updatedOffer.remainingQuantity > 0 &&
          now >= updatedOffer.startDate &&
          now <= updatedOffer.endDate
        ) {
          await this.offerRepository.update({
            filters: { _id: offerId },
            body: { status: OfferStatusEnum.ACTIVE } as any,
          });
        }

        // Reverse AI recommendation statistics
        if (updatedOffer && updatedOffer.recommendationId) {
          await this.offerRepository.update({
            filters: { _id: offerId },
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

    // Recompute and persist parent OrderGroup's overallStatus
    if (order.groupOrderId) {
      const siblingOrders = await this.orderRepository.findMany({
        filters: { groupOrderId: order.groupOrderId },
      });
      const newOverallStatus = this.computeOverallStatus(siblingOrders || []);
      await this.orderGroupRepository.update({
        filters: { _id: order.groupOrderId },
        body: { overallStatus: newOverallStatus } as any,
      });
    }

    return { data: updated };
  }
}
