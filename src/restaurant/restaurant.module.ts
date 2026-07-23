import { Module } from '@nestjs/common';
import { RestaurantService } from './restaurant.service';
import { RestaurantController } from './restaurant.controller';
import {
  RestaurantRepository,
  ProductRepository,
  OfferRepository,
} from 'src/DB/Repositories';
import { RestaurantModel, ProductModel, OfferModel } from 'src/DB/Models';

@Module({
  imports: [RestaurantModel, ProductModel, OfferModel],
  controllers: [RestaurantController],
  providers: [
    RestaurantService,
    RestaurantRepository,
    ProductRepository,
    OfferRepository,
  ],
  exports: [
    RestaurantService,
    RestaurantRepository,
    ProductRepository,
    OfferRepository,
  ],
})
export class RestaurantModule {}
