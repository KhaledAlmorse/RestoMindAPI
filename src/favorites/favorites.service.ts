import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FavoriteRepository, OfferRepository } from 'src/DB/Repositories';
import { isValidObjectId, Types } from 'mongoose';
import { OfferStatusEnum } from 'src/Common/Types';

@Injectable()
export class FavoritesService {
  constructor(
    private readonly favoriteRepository: FavoriteRepository,
    private readonly offerRepository: OfferRepository,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  async addFavorite(userId: string, offerId: string) {
    this.validateObjectId(offerId);

    const offer = await this.offerRepository.findOne({
      filters: { _id: new Types.ObjectId(offerId), isDeleted: false },
    });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }

    const allowedStatuses = [OfferStatusEnum.ACTIVE, OfferStatusEnum.SCHEDULED];
    if (!allowedStatuses.includes(offer.status)) {
      throw new BadRequestException(
        `Cannot favorite an offer with status '${offer.status}'`,
      );
    }

    const userObjId = new Types.ObjectId(userId);
    const offerObjId = new Types.ObjectId(offerId);

    const existing = await this.favoriteRepository.findOne({
      filters: {
        $or: [
          { userId: userObjId, offerId: offerObjId },
          { userId: userId, offerId: offerId },
        ],
      },
    });
    if (existing) {
      throw new ConflictException('Offer is already in favorites');
    }

    try {
      const newFav = await this.favoriteRepository.create({
        userId: userObjId,
        offerId: offerObjId,
      });
      return { data: newFav };
    } catch (error: any) {
      if (error?.code === 11000 || error?.name === 'MongoServerError') {
        throw new ConflictException('Offer is already in favorites');
      }
      throw error;
    }
  }

  async removeFavorite(userId: string, offerId: string) {
    this.validateObjectId(offerId);

    const userObjId = new Types.ObjectId(userId);
    const offerObjId = new Types.ObjectId(offerId);

    const existing = await this.favoriteRepository.findOne({
      filters: {
        $or: [
          { userId: userObjId, offerId: offerObjId },
          { userId: userId, offerId: offerId },
        ],
      },
    });
    if (!existing) {
      throw new NotFoundException('Offer is not in favorites');
    }

    await this.favoriteRepository.delete({ filters: { _id: existing._id } });
    return { message: 'Offer removed from favorites' };
  }

  async getFavorites(userId: string) {
    const userObjId = new Types.ObjectId(userId);

    const favorites =
      (await this.favoriteRepository.findMany({
        filters: {
          $or: [{ userId: userObjId }, { userId: userId }],
        },
        populationArray: [
          {
            path: 'offerId',
            populate: [{ path: 'productId' }, { path: 'restaurantId' }],
          },
        ],
      })) || [];

    const offers = favorites
      .map((fav) => fav.offerId)
      .filter(
        (off) =>
          off !== null && typeof off === 'object' && !(off as any).isDeleted,
      );

    return { data: offers };
  }

  async checkFavoriteStatus(userId: string, offerId: string) {
    this.validateObjectId(offerId);

    const userObjId = new Types.ObjectId(userId);
    const offerObjId = new Types.ObjectId(offerId);

    const existing = await this.favoriteRepository.findOne({
      filters: {
        $or: [
          { userId: userObjId, offerId: offerObjId },
          { userId: userId, offerId: offerId },
        ],
      },
    });
    return { isFavorite: !!existing };
  }
}
