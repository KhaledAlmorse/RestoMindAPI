import { Injectable, OnModuleInit } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Favorite, FavoriteType } from '../Models/favorite.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class FavoriteRepository
  extends BaseService<FavoriteType>
  implements OnModuleInit
{
  constructor(
    @InjectModel(Favorite.name)
    private readonly favoriteModel: Model<FavoriteType>,
  ) {
    super(favoriteModel);
  }

  async onModuleInit() {
    try {
      await this.favoriteModel.collection.dropIndex('userId_1_productId_1');
    } catch {
      // Index might not exist; ignore safely
    }
    try {
      await this.favoriteModel.syncIndexes();
    } catch {
      // Ignore sync index error if collection doesn't exist yet
    }
  }
}
