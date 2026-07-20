import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OffersService } from './offers.service';
import { OffersController } from './offers.controller';
import { OfferRepository, ProductRepository, RestaurantRepository } from 'src/DB/Repositories';
import { OfferModel, ProductModel, RestaurantModel } from 'src/DB/Models';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    OfferModel,
    ProductModel,
    RestaurantModel,
  ],
  controllers: [OffersController],
  providers: [OffersService, OfferRepository, ProductRepository, RestaurantRepository],
  exports: [OffersService, OfferRepository],
})
export class OffersModule {}
