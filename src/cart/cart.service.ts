import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CartRepository,
  OfferRepository,
  OrderRepository,
} from 'src/DB/Repositories';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { isValidObjectId, Types } from 'mongoose';
import { OfferStatusEnum } from 'src/Common/Types';

@Injectable()
export class CartService {
  constructor(
    private readonly cartRepository: CartRepository,
    private readonly offerRepository: OfferRepository,
    private readonly orderRepository: OrderRepository,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  async validateOfferForCart(
    offerId: string,
    requestedQuantity: number,
    userId: string,
  ) {
    // 1. Offer exists check
    const offer = await this.offerRepository.findOne({
      filters: { _id: new Types.ObjectId(offerId), isDeleted: false },
    });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }

    // 2. Offer status check
    if (offer.status === OfferStatusEnum.SOLD_OUT) {
      throw new BadRequestException('Offer is sold out');
    }
    if (offer.status === OfferStatusEnum.EXPIRED) {
      throw new BadRequestException('Offer has expired');
    }
    if (offer.status === OfferStatusEnum.CANCELLED) {
      throw new BadRequestException('Offer has been cancelled');
    }
    if (offer.status === OfferStatusEnum.DRAFT) {
      throw new BadRequestException('Offer is a draft');
    }
    if (offer.status === OfferStatusEnum.SCHEDULED) {
      throw new BadRequestException('Offer is scheduled for a future date');
    }
    if (offer.status !== OfferStatusEnum.ACTIVE) {
      throw new BadRequestException(`Offer is not active`);
    }

    // 3. Date window check
    const now = new Date();
    if (now < offer.startDate || now > offer.endDate) {
      throw new BadRequestException('Offer is not currently active');
    }

    // 4. Remaining quantity check
    if (offer.remainingQuantity <= 0) {
      throw new BadRequestException('Offer is sold out');
    }
    if (offer.remainingQuantity < requestedQuantity) {
      throw new BadRequestException(
        `Only ${offer.remainingQuantity} left in stock`,
      );
    }

    // 5. Max per customer check
    if (offer.maxPerCustomer && offer.maxPerCustomer > 0) {
      const pastOrders = await this.orderRepository.findMany({
        filters: {
          userId: new Types.ObjectId(userId),
          status: { $ne: 'Cancelled' },
          'items.offerId': offer._id,
        },
      });

      let pastQuantity = 0;
      for (const ord of pastOrders || []) {
        for (const item of ord.items || []) {
          if (item.offerId?.toString() === offer._id.toString()) {
            pastQuantity += item.quantity;
          }
        }
      }

      if (pastQuantity + requestedQuantity > offer.maxPerCustomer) {
        throw new BadRequestException(
          "You've reached the purchase limit for this offer",
        );
      }
    }

    return offer;
  }

  async getCart(userId: string) {
    let cart = await this.cartRepository.findOne({
      filters: { userId },
      populationArray: [
        {
          path: 'items.offerId',
          populate: [{ path: 'productId' }, { path: 'restaurantId' }],
        },
      ],
    });

    if (!cart) {
      cart = await this.cartRepository.create({
        userId: userId as any,
        items: [],
      });
    }

    const items: any[] = [];
    let totalQuantity = 0;
    let totalOriginalPrice = 0;
    let totalDiscount = 0;
    let finalTotalPrice = 0;

    for (const item of cart.items) {
      const offer = item.offerId as any;
      if (!offer || offer.isDeleted) {
        continue;
      }

      const product = offer.productId as any;
      const restaurant = offer.restaurantId as any;

      const quantity = item.quantity;
      const unitOriginalPrice = offer.originalPrice;
      const unitOfferPrice = offer.offerPrice;
      const totalItemPrice = unitOfferPrice * quantity;

      items.push({
        offer: {
          _id: offer._id,
          status: offer.status,
          discountPercentage: offer.discountPercentage,
          originalPrice: offer.originalPrice,
          offerPrice: offer.offerPrice,
          remainingQuantity: offer.remainingQuantity,
          maxPerCustomer: offer.maxPerCustomer,
          startDate: offer.startDate,
          endDate: offer.endDate,
          product: product
            ? {
                _id: product._id,
                title: product.title,
                image: product.image,
              }
            : null,
          restaurant: restaurant
            ? {
                _id: restaurant._id,
                name:
                  restaurant.name ||
                  restaurant.restaurantName ||
                  restaurant.title ||
                  '',
              }
            : null,
        },
        quantity,
        unitOriginalPrice,
        unitOfferPrice,
        totalItemPrice,
      });

      totalQuantity += quantity;
      totalOriginalPrice += unitOriginalPrice * quantity;
      finalTotalPrice += totalItemPrice;
    }

    totalDiscount = totalOriginalPrice - finalTotalPrice;

    return {
      data: {
        _id: cart._id,
        userId: cart.userId,
        items,
        totalQuantity,
        totalOriginalPrice,
        totalDiscount,
        finalTotalPrice,
      },
    };
  }

  async addToCart(userId: string, body: AddToCartDto) {
    const { offerId, quantity } = body;
    this.validateObjectId(offerId);

    let cart = await this.cartRepository.findOne({ filters: { userId } });
    if (!cart) {
      cart = await this.cartRepository.create({
        userId: userId as any,
        items: [],
      });
    }

    const itemIndex = cart.items.findIndex(
      (item) => item.offerId?.toString() === offerId,
    );

    const currentQtyInCart =
      itemIndex > -1 ? cart.items[itemIndex].quantity : 0;
    const requestedTotalQty = currentQtyInCart + quantity;

    await this.validateOfferForCart(offerId, requestedTotalQty, userId);

    if (itemIndex > -1) {
      cart.items[itemIndex].quantity += quantity;
    } else {
      cart.items.push({
        offerId: new Types.ObjectId(offerId) as any,
        quantity,
      });
    }

    await this.cartRepository.save(cart);
    return this.getCart(userId);
  }

  async removeFromCart(userId: string, offerId: string) {
    this.validateObjectId(offerId);
    const cart = await this.cartRepository.findOne({ filters: { userId } });
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    cart.items = cart.items.filter(
      (item) => item.offerId?.toString() !== offerId,
    );

    await this.cartRepository.save(cart);
    return this.getCart(userId);
  }

  async updateQuantity(userId: string, offerId: string, quantity: number) {
    this.validateObjectId(offerId);
    const cart = await this.cartRepository.findOne({ filters: { userId } });
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    const itemIndex = cart.items.findIndex(
      (item) => item.offerId?.toString() === offerId,
    );

    if (itemIndex === -1) {
      throw new NotFoundException('Item not found in cart');
    }

    await this.validateOfferForCart(offerId, quantity, userId);

    cart.items[itemIndex].quantity = quantity;
    await this.cartRepository.save(cart);
    return this.getCart(userId);
  }

  async clearCart(userId: string) {
    const cart = await this.cartRepository.findOne({ filters: { userId } });
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    cart.items = [];
    await this.cartRepository.save(cart);
    return { message: 'Cart cleared successfully' };
  }
}
