import {
  BadRequestException,
  ForbiddenException,
  Injectable,
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
} from 'src/DB/Repositories';
import { CreateOrderDto } from './dto/create-order.dto';
import { Decrypt } from 'src/Common/Security';
import { OfferStatusEnum, RolesEnum } from 'src/Common/Types';
import { UserType } from 'src/DB/Models';

@Injectable()
export class OrdersService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly orderGroupRepository: OrderGroupRepository,
    private readonly cartRepository: CartRepository,
    private readonly productRepository: ProductRepository,
    private readonly userRepository: UserRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly offerRepository: OfferRepository,
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

  private async formatOrderGroup(group: any) {
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

    const overallStatus = this.computeOverallStatus(childOrders);

    const formattedChildOrders = childOrders
      .filter((sub: any) => sub && typeof sub === 'object' && sub._id)
      .map((sub: any) => {
        const restaurant = sub.restaurantId;
        const restaurantObj = restaurant
          ? {
              _id: restaurant._id
                ? restaurant._id.toString()
                : restaurant.toString(),
              name:
                restaurant.name ||
                restaurant.restaurantName ||
                restaurant.title ||
                '',
            }
          : null;

        const items = (sub.items || []).map((item: any) => ({
          offerId: item.offerId?._id
            ? item.offerId._id.toString()
            : item.offerId?.toString() || item.offerId,
          productId: item.productId?._id
            ? item.productId._id.toString()
            : item.productId?.toString() || item.productId,
          productTitle: item.productTitle || item.title || '',
          productImage: item.productImage || '',
          restaurantId: item.restaurantId?._id
            ? item.restaurantId._id.toString()
            : item.restaurantId?.toString() || item.restaurantId,
          restaurantName: item.restaurantName || '',
          originalPrice: item.originalPrice ?? item.price ?? 0,
          offerPrice: item.offerPrice ?? item.discountedPrice ?? 0,
          discountPercentage: item.discountPercentage ?? 0,
          quantity: item.quantity,
          purchasedAt: item.purchasedAt || sub.createdAt,
          lineTotal:
            item.lineTotal ??
            (item.offerPrice ?? item.discountedPrice ?? 0) * item.quantity,
        }));

        return {
          orderId: sub._id ? sub._id.toString() : sub.toString(),
          restaurant: restaurantObj,
          items,
          totalOriginalPrice: sub.totalOriginalPrice ?? 0,
          totalDiscount: sub.totalDiscount ?? 0,
          finalTotalPrice: sub.finalTotalPrice ?? 0,
          totalQuantity: sub.totalQuantity ?? 0,
          status: sub.status || 'Pending',
          createdAt: sub.createdAt,
        };
      });

    return {
      orderGroupId: group._id.toString(),
      userId: group.userId?._id
        ? group.userId._id.toString()
        : group.userId?.toString(),
      fullName: group.fullName,
      phoneNumber: group.phoneNumber,
      emailAddress: group.emailAddress,
      deliveryMethod: group.deliveryMethod,
      deliveryAddress: group.deliveryAddress,
      specialNotes: group.specialNotes,
      paymentMethod: group.paymentMethod,
      totalOriginalPrice: group.totalOriginalPrice ?? 0,
      totalDiscount: group.totalDiscount ?? 0,
      finalTotalPrice: group.finalTotalPrice ?? 0,
      totalQuantity: group.totalQuantity ?? 0,
      overallStatus,
      orders: formattedChildOrders,
      createdAt: group.createdAt,
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
      });

      // Clear customer's cart
      cart.items = [];
      await this.cartRepository.save(cart);
    });

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

  async getMyOrders(userId: string, restaurantId?: string) {
    this.validateObjectId(userId);

    const userObjId = new Types.ObjectId(userId);
    const groups = await this.orderGroupRepository.findMany({
      filters: {
        $or: [{ userId: userObjId }, { userId }],
      },
      populationArray: [
        {
          path: 'orderIds',
          populate: [{ path: 'restaurantId' }],
        },
      ],
    });

    if (!groups || groups.length === 0) {
      return { data: [] };
    }

    let resultGroups = groups;
    if (restaurantId && restaurantId !== 'undefined' && restaurantId !== '') {
      this.validateObjectId(restaurantId);
      resultGroups = groups.filter((group: any) =>
        (group.orderIds || []).some(
          (sub: any) =>
            sub.restaurantId?._id?.toString() === restaurantId ||
            sub.restaurantId?.toString() === restaurantId,
        ),
      );
    }

    const formattedGroups = await Promise.all(
      resultGroups.map((g) => this.formatOrderGroup(g)),
    );
    return { data: formattedGroups };
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

  async getOrderGroupById(id: string, userId?: string) {
    this.validateObjectId(id);
    const targetId = new Types.ObjectId(id);

    const filters: any = {
      $or: [{ _id: targetId }, { orderIds: targetId }],
    };

    if (userId) {
      this.validateObjectId(userId);
      filters.userId = new Types.ObjectId(userId);
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

    return { data: await this.formatOrderGroup(group) };
  }

  async getAllOrders(restaurantId?: string) {
    const filters: any = {};
    if (restaurantId && restaurantId !== 'undefined' && restaurantId !== '') {
      this.validateObjectId(restaurantId);
      filters.restaurantId = new Types.ObjectId(restaurantId);
    }
    const orders = await this.orderRepository.findMany({
      filters,
      populationArray: [{ path: 'restaurantId' }],
    });
    return { data: orders ?? [] };
  }

  async getRestaurantOrders(restaurantId: string) {
    this.validateObjectId(restaurantId);
    const restaurant = await this.restaurantRepository.findOne({
      filters: { _id: restaurantId, isDeleted: false },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }
    const orders = await this.orderRepository.findMany({
      filters: { restaurantId: new Types.ObjectId(restaurantId) },
      populationArray: [{ path: 'userId', select: '-password' }],
    });
    return { data: orders ?? [] };
  }

  async updateOrderStatus(
    id: string,
    status: string,
    currentUser?: UserType,
  ) {
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

    return { data: updated };
  }
}
