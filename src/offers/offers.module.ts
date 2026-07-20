import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OffersService } from './offers.service';
import { OffersController } from './offers.controller';
import {
  OfferRepository,
  ProductRepository,
  RestaurantRepository,
  UserRepository,
} from 'src/DB/Repositories';
import {
  OfferModel,
  ProductModel,
  RestaurantModel,
  UserModel,
} from 'src/DB/Models';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    OfferModel,
    ProductModel,
    RestaurantModel,
    UserModel,
  ],
  controllers: [OffersController],
  providers: [
    OffersService,
    OfferRepository,
    ProductRepository,
    RestaurantRepository,
    UserRepository,
  ],
  exports: [OffersService, OfferRepository],
})
export class OffersModule {}
