import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Favorite, FavoriteType } from '../Models/favorite.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class FavoriteRepository extends BaseService<FavoriteType> {
  constructor(
    @InjectModel(Favorite.name)
    private readonly favoriteModel: Model<FavoriteType>,
  ) {
    super(favoriteModel);
  }
}
