import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderRepository,
  CartRepository,
  ProductRepository,
} from 'src/DB/Repositories';
import { isValidObjectId } from 'mongoose';

@Injectable()
export class OrdersService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly cartRepository: CartRepository,
    private readonly productRepository: ProductRepository,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  async createOrder(userId: string) {
    const cart = await this.cartRepository.findOne({
      filters: { userId },
      populationArray: [{ path: 'items.productId' }],
    });

    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Your cart is empty');
    }

    const orderItems: any[] = [];
    let totalQuantity = 0;
    let totalOriginalPrice = 0;
    let finalTotalPrice = 0;

    for (const item of cart.items) {
      const product = item.productId as any;
      if (!product || product.isDeleted) {
        throw new BadRequestException(
          `One or more products in your cart are no longer available`,
        );
      }
      if (!product.isAvailable) {
        throw new BadRequestException(
          `Product "${product.title}" is currently out of stock/unavailable`,
        );
      }

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
      userId: userId as any,
      items: orderItems,
      totalOriginalPrice,
      totalDiscount,
      finalTotalPrice,
      totalQuantity,
      paymentMethod: 'CASH',
      status: 'Pending',
    });

    // Empty the cart
    cart.items = [];
    await this.cartRepository.save(cart);

    return { data: newOrder };
  }

  async getMyOrders(userId: string) {
    const orders = await this.orderRepository.findMany({
      filters: { userId },
    });
    return { data: orders };
  }

  async getMyOrderDetails(userId: string, orderId: string) {
    this.validateObjectId(orderId);
    const order = await this.orderRepository.findOne({
      filters: { _id: orderId, userId },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return { data: order };
  }

  async getAllOrders() {
    const orders = await this.orderRepository.findMany({});
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
