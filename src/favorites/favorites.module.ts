import { Module } from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { FavoritesController } from './favorites.controller';
import { FavoriteRepository, ProductRepository } from 'src/DB/Repositories';
import { FavoriteModel, ProductModel } from 'src/DB/Models';

@Module({
  imports: [FavoriteModel, ProductModel],
  controllers: [FavoritesController],
  providers: [FavoritesService, FavoriteRepository, ProductRepository],
  exports: [FavoritesService, FavoriteRepository],
})
export class FavoritesModule {}
