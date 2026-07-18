import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderRepository,
  CartRepository,
  ProductRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { isValidObjectId, Types } from 'mongoose';
import { CreateOrderDto } from './dto/create-order.dto';
import { Decrypt } from 'src/Common/Security';

@Injectable()
export class OrdersService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly cartRepository: CartRepository,
    private readonly productRepository: ProductRepository,
    private readonly userRepository: UserRepository,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
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

    const createdOrders: any[] = [];

    // Create an order for each restaurant group
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

      const newOrder = await this.orderRepository.create({
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

      createdOrders.push(newOrder);
    }

    // Empty the cart
    cart.items = [];
    await this.cartRepository.save(cart);

    if (createdOrders.length === 1) {
      return { data: createdOrders[0] };
    } else {
      return { data: createdOrders };
    }
  }

  async getMyOrders(userId: string, restaurantId?: string) {
    const filters: any = { userId };
    if (restaurantId && restaurantId !== 'undefined' && restaurantId !== '') {
      this.validateObjectId(restaurantId);
      filters.restaurantId = new Types.ObjectId(restaurantId);
    }
    const orders = await this.orderRepository.findMany({
      filters,
      populationArray: [{ path: 'restaurantId' }],
    });
    return { data: orders };
  }

  async getMyOrderDetails(userId: string, orderId: string) {
    this.validateObjectId(orderId);
    const order = await this.orderRepository.findOne({
      filters: { _id: orderId, userId },
      populationArray: [{ path: 'restaurantId' }],
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return { data: order };
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
    return { data: orders };
  }

  async getRestaurantOrders(restaurantId: string) {
    this.validateObjectId(restaurantId);
    const orders = await this.orderRepository.findMany({
      filters: { restaurantId: new Types.ObjectId(restaurantId) },
      populationArray: [{ path: 'userId', select: '-password' }],
    });
    return { data: orders };
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
