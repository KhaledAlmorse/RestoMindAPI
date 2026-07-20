import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductRepository, CategoryRepository, OfferRepository } from 'src/DB/Repositories';
import { ProductModel, CategoryModel, OfferModel } from 'src/DB/Models';
import { RestaurantModule } from 'src/restaurant/restaurant.module';
import { OffersModule } from 'src/offers/offers.module';

@Module({
  imports: [ProductModel, CategoryModel, RestaurantModule, OffersModule, OfferModel],
  controllers: [ProductsController],
  providers: [ProductsService, ProductRepository, CategoryRepository, OfferRepository],
  exports: [ProductsService, ProductRepository],
})
export class ProductsModule {}
