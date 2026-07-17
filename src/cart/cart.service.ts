import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CartRepository, ProductRepository } from 'src/DB/Repositories';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { isValidObjectId } from 'mongoose';

@Injectable()
export class CartService {
  constructor(
    private readonly cartRepository: CartRepository,
    private readonly productRepository: ProductRepository,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  async getCart(userId: string) {
    let cart = await this.cartRepository.findOne({
      filters: { userId },
      populationArray: [
        { path: 'items.productId', populate: { path: 'category' } },
      ],
    });

    if (!cart) {
      cart = await this.cartRepository.create({
        userId: userId as any,
        items: [],
      });
    }

    // Process items and calculate totals
    const items: any[] = [];
    let totalQuantity = 0;
    let totalOriginalPrice = 0;
    let totalDiscount = 0;
    let finalTotalPrice = 0;

    for (const item of cart.items) {
      const product = item.productId as any;
      if (!product || product.isDeleted) {
        continue; // Skip deleted products
      }

      const quantity = item.quantity;
      const unitPrice = product.price;
      const discountedPrice =
        product.discountedPrice !== undefined && product.discountedPrice > 0
          ? product.discountedPrice
          : unitPrice;
      const totalItemPrice = discountedPrice * quantity;

      items.push({
        product: {
          _id: product._id,
          title: product.title,
          description: product.description,
          price: product.price,
          discountedPrice: discountedPrice,
          image: product.image,
          isAvailable: product.isAvailable,
        },
        quantity,
        unitPrice,
        discountedPrice,
        totalItemPrice,
      });

      totalQuantity += quantity;
      totalOriginalPrice += unitPrice * quantity;
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
    const { productId, quantity } = body;
    this.validateObjectId(productId);

    const product = await this.productRepository.findOne({
      filters: { _id: productId, isDeleted: false },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    if (!product.isAvailable) {
      throw new BadRequestException('Product is currently unavailable');
    }

    let cart = await this.cartRepository.findOne({ filters: { userId } });
    if (!cart) {
      cart = await this.cartRepository.create({
        userId: userId as any,
        items: [],
      });
    }

    const itemIndex = cart.items.findIndex(
      (item) => item.productId.toString() === productId,
    );

    if (itemIndex > -1) {
      cart.items[itemIndex].quantity += quantity;
    } else {
      cart.items.push({
        productId: productId as any,
        quantity,
      });
    }

    await this.cartRepository.save(cart);
    return this.getCart(userId);
  }

  async removeFromCart(userId: string, productId: string) {
    this.validateObjectId(productId);
    const cart = await this.cartRepository.findOne({ filters: { userId } });
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    cart.items = cart.items.filter(
      (item) => item.productId.toString() !== productId,
    );

    await this.cartRepository.save(cart);
    return this.getCart(userId);
  }

  async updateQuantity(userId: string, productId: string, quantity: number) {
    this.validateObjectId(productId);
    const cart = await this.cartRepository.findOne({ filters: { userId } });
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    const itemIndex = cart.items.findIndex(
      (item) => item.productId.toString() === productId,
    );

    if (itemIndex === -1) {
      throw new NotFoundException('Item not found in cart');
    }

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
