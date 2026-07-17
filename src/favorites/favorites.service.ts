import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FavoriteRepository, ProductRepository } from 'src/DB/Repositories';
import { isValidObjectId } from 'mongoose';

@Injectable()
export class FavoritesService {
  constructor(
    private readonly favoriteRepository: FavoriteRepository,
    private readonly productRepository: ProductRepository,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  async addFavorite(userId: string, productId: string) {
    this.validateObjectId(productId);
    const product = await this.productRepository.findOne({
      filters: { _id: productId, isDeleted: false },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const existing = await this.favoriteRepository.findOne({
      filters: { userId, productId },
    });
    if (existing) {
      throw new ConflictException('Product is already in favorites');
    }

    const newFav = await this.favoriteRepository.create({
      userId: userId as any,
      productId: productId as any,
    });
    return { data: newFav };
  }

  async removeFavorite(userId: string, productId: string) {
    this.validateObjectId(productId);
    const existing = await this.favoriteRepository.findOne({
      filters: { userId, productId },
    });
    if (!existing) {
      throw new NotFoundException('Product is not in favorites');
    }

    await this.favoriteRepository.delete({ filters: { _id: existing._id } });
    return { message: 'Product removed from favorites' };
  }

  async getFavorites(userId: string) {
    const favorites =
      (await this.favoriteRepository.findMany({
        filters: { userId },
        populationArray: [
          { path: 'productId', populate: { path: 'category' } },
        ],
      })) || [];
    const products = favorites
      .map((fav) => fav.productId)
      .filter((prod) => prod !== null && !(prod as any).isDeleted);
    return { data: products };
  }

  async checkFavoriteStatus(userId: string, productId: string) {
    this.validateObjectId(productId);
    const existing = await this.favoriteRepository.findOne({
      filters: { userId, productId },
    });
    return { isFavorite: !!existing };
  }
}
