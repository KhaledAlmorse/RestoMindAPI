import { Module } from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { FavoritesController } from './favorites.controller';
import {
  FavoriteRepository,
  ProductRepository,
  OfferRepository,
} from 'src/DB/Repositories';
import { FavoriteModel, ProductModel, OfferModel } from 'src/DB/Models';

@Module({
  imports: [FavoriteModel, ProductModel, OfferModel],
  controllers: [FavoritesController],
  providers: [
    FavoritesService,
    FavoriteRepository,
    ProductRepository,
    OfferRepository,
  ],
  exports: [FavoritesService, FavoriteRepository],
})
export class FavoritesModule {}
