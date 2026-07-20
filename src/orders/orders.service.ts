import {
  BadRequestException,
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
} from 'src/DB/Repositories';
import { CreateOrderDto } from './dto/create-order.dto';
import { Decrypt } from 'src/Common/Security';

@Injectable()
export class OrdersService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly orderGroupRepository: OrderGroupRepository,
    private readonly cartRepository: CartRepository,
    private readonly productRepository: ProductRepository,
    private readonly userRepository: UserRepository,
    private readonly restaurantRepository: RestaurantRepository,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  private computeOverallStatus(suborders: any[]): string {
    if (!suborders || suborders.length === 0) return 'Pending';
    const statuses = suborders.map((s) => s.status);

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

  private formatOrderGroup(group: any) {
    const suborders = group.restaurantOrderIds || [];
    const overallStatus = this.computeOverallStatus(suborders);

    const restaurantOrders = suborders.map((sub: any) => {
      const restaurant = sub.restaurantId;
      return {
        orderId: sub._id ? sub._id.toString() : sub.toString(),
        restaurant: restaurant
          ? {
              _id: restaurant._id
                ? restaurant._id.toString()
                : restaurant.toString(),
              name: restaurant.name || '',
            }
          : null,
        items: (sub.items || []).map((item: any) => ({
          productId: item.productId?._id
            ? item.productId._id.toString()
            : item.productId?.toString() || item.productId,
          title: item.title,
          price: item.price,
          discountedPrice: item.discountedPrice,
          quantity: item.quantity,
        })),
        totalOriginalPrice: sub.totalOriginalPrice,
        totalDiscount: sub.totalDiscount,
        finalTotalPrice: sub.finalTotalPrice,
        status: sub.status,
      };
    });

    return {
      _id: group._id,
      fullName: group.fullName,
      phoneNumber: group.phoneNumber,
      emailAddress: group.emailAddress,
      deliveryMethod: group.deliveryMethod,
      deliveryAddress: group.deliveryAddress,
      specialNotes: group.specialNotes,
      paymentMethod: group.paymentMethod,
      totalOriginalPrice: group.totalOriginalPrice,
      totalDiscount: group.totalDiscount,
      finalTotalPrice: group.finalTotalPrice,
      totalQuantity: group.totalQuantity,
      overallStatus,
      restaurantOrders,
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
          // Ignore errors during transaction abort (e.g. if transaction was not active)
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
          // Ignore errors during session closure
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

    const cart = await this.cartRepository.findOne({
      filters: { userId },
      populationArray: [{ path: 'items.productId' }],
    });

    if (!cart || cart.items.length === 0) {
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

    // Group cart items by their product's restaurantId
    const restaurantGroups = new Map<string, any[]>();
    for (const item of cart.items) {
      const product = item.productId as any;
      if (!product || product.isDeleted) {
        throw new BadRequestException(
          'One or more products in your cart are no longer available',
        );
      }
      if (!product.isAvailable) {
        throw new BadRequestException(
          `Product "${product.title}" is currently out of stock/unavailable`,
        );
      }
      if (!product.restaurantId) {
        throw new BadRequestException(
          `Product "${product.title}" does not have an associated restaurant`,
        );
      }

      const restId = product.restaurantId.toString();
      if (!restaurantGroups.has(restId)) {
        restaurantGroups.set(restId, []);
      }
      restaurantGroups.get(restId)!.push(item);
    }

    const orderGroupId = new Types.ObjectId();
    const createdOrderIds: Types.ObjectId[] = [];
    let groupTotalOriginalPrice = 0;
    let groupTotalDiscount = 0;
    let groupFinalTotalPrice = 0;
    let groupTotalQuantity = 0;

    await this.runTransaction(async (_session) => {
      for (const [restaurantId, items] of restaurantGroups.entries()) {
        const orderItems: any[] = [];
        let totalQuantity = 0;
        let totalOriginalPrice = 0;
        let finalTotalPrice = 0;

        for (const item of items) {
          const product = item.productId;
          const quantity = item.quantity;
          const price = product.price;
          const discountedPrice =
            product.discountedPrice !== undefined && product.discountedPrice > 0
              ? product.discountedPrice
              : price;
          const totalItemPrice = discountedPrice * quantity;

          orderItems.push({
            productId: product._id,
            title: product.title,
            price,
            discountedPrice,
            quantity,
          });

          totalQuantity += quantity;
          totalOriginalPrice += price * quantity;
          finalTotalPrice += totalItemPrice;
        }

        const totalDiscount = totalOriginalPrice - finalTotalPrice;

        groupTotalQuantity += totalQuantity;
        groupTotalOriginalPrice += totalOriginalPrice;
        groupFinalTotalPrice += finalTotalPrice;
        groupTotalDiscount += totalDiscount;

        const newOrder = await this.orderRepository.create({
          orderGroupId,
          userId: new Types.ObjectId(userId),
          restaurantId: new Types.ObjectId(restaurantId),
          items: orderItems,
          totalOriginalPrice,
          totalDiscount,
          finalTotalPrice,
          totalQuantity,
          fullName: fullName,
          phoneNumber: userPhone,
          emailAddress: dbUser.email,
          deliveryMethod: body.deliveryMethod,
          deliveryAddress: resolvedAddress,
          specialNotes: body.specialNotes,
          paymentMethod: body.paymentMethod, // 'Cash on Delivery'
          status: 'Pending',
        });

        createdOrderIds.push(newOrder._id);
      }

      await this.orderGroupRepository.create({
        _id: orderGroupId,
        userId: new Types.ObjectId(userId),
        restaurantOrderIds: createdOrderIds,
        fullName: fullName,
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

      // Empty the cart
      cart.items = [];
      await this.cartRepository.save(cart);
    });

    const populatedGroup = await this.orderGroupRepository.findOne({
      filters: { _id: orderGroupId },
      populationArray: [
        {
          path: 'restaurantOrderIds',
          populate: { path: 'restaurantId' },
        },
      ],
    });

    return { data: this.formatOrderGroup(populatedGroup) };
  }

  async getMyOrders(userId: string, restaurantId?: string) {
    this.validateObjectId(userId);

    const filters: any = { userId: new Types.ObjectId(userId) };
    if (restaurantId && restaurantId !== 'undefined' && restaurantId !== '') {
      this.validateObjectId(restaurantId);
      filters.restaurantId = new Types.ObjectId(restaurantId);
    }

    const orders = await this.orderRepository.findMany({
      filters,
      populationArray: [{ path: 'restaurantId' }],
    });

    if (!orders || orders.length === 0) {
      throw new NotFoundException('No orders found');
    }

    let totalOriginalPrice = 0;
    let totalDiscount = 0;
    let finalTotalPrice = 0;
    let totalQuantity = 0;

    const formattedOrders = orders.map((order: any) => {
      totalOriginalPrice += order.totalOriginalPrice || 0;
      totalDiscount += order.totalDiscount || 0;
      finalTotalPrice += order.finalTotalPrice || 0;
      totalQuantity += order.totalQuantity || 0;

      const restaurantObj = order.restaurantId
        ? {
            _id: order.restaurantId._id
              ? order.restaurantId._id.toString()
              : order.restaurantId.toString(),
            name:
              order.restaurantId.name ||
              order.restaurantId.title ||
              order.restaurantId.restaurantName ||
              '',
          }
        : null;

      return {
        orderId: order._id.toString(),
        restaurant: restaurantObj,
        status: order.status,
        items: order.items,
        totalOriginalPrice: order.totalOriginalPrice,
        totalDiscount: order.totalDiscount,
        finalTotalPrice: order.finalTotalPrice,
        totalQuantity: order.totalQuantity,
        createdAt: order.createdAt,
      };
    });

    const firstOrder = orders[0];

    return {
      data: {
        userId,
        fullName: firstOrder.fullName || '',
        phoneNumber: firstOrder.phoneNumber || '',
        emailAddress: firstOrder.emailAddress || '',
        totalOriginalPrice,
        totalDiscount,
        finalTotalPrice,
        totalQuantity,
        orders: formattedOrders,
      },
    };
  }

  async getMyOrderDetails(userId: string, orderId: string) {
    this.validateObjectId(userId);
    this.validateObjectId(orderId);

    const order: any = await this.orderRepository.findOne({
      filters: {
        _id: new Types.ObjectId(orderId),
        userId: new Types.ObjectId(userId),
      },
      populationArray: [{ path: 'restaurantId' }],
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const restaurantObj = order.restaurantId
      ? {
          _id: order.restaurantId._id
            ? order.restaurantId._id.toString()
            : order.restaurantId.toString(),
          name:
            order.restaurantId.name ||
            order.restaurantId.title ||
            order.restaurantId.restaurantName ||
            '',
        }
      : null;

    return {
      data: {
        orderId: order._id.toString(),
        userId,
        fullName: order.fullName,
        phoneNumber: order.phoneNumber,
        emailAddress: order.emailAddress,
        deliveryMethod: order.deliveryMethod,
        deliveryAddress: order.deliveryAddress,
        specialNotes: order.specialNotes,
        paymentMethod: order.paymentMethod,
        restaurant: restaurantObj,
        status: order.status,
        items: order.items,
        totalOriginalPrice: order.totalOriginalPrice,
        totalDiscount: order.totalDiscount,
        finalTotalPrice: order.finalTotalPrice,
        totalQuantity: order.totalQuantity,
        createdAt: order.createdAt,
      },
    };
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

  async updateOrderStatus(id: string, status: string) {
    this.validateObjectId(id);
    const order = await this.orderRepository.findOne({ filters: { _id: id } });
    if (!order) {
      throw new NotFoundException('Order not found');
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
    return { data: updated };
  }
}
