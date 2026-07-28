import { Module } from '@nestjs/common';
import { OffersService } from './offers.service';
import { OffersController } from './offers.controller';
import { OfferPricingService } from './services/offer-pricing.service';
import { OfferRulesService } from './services/offer-rules.service';
import { OfferAccessService } from './services/offer-access.service';
import { OffersQueryService } from './services/offers-query.service';
import { OffersCronService } from './services/offers-cron.service';
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
    OfferModel,
    ProductModel,
    RestaurantModel,
    UserModel,
  ],
  controllers: [OffersController],
  providers: [
    OffersService,
    OfferPricingService,
    OfferRulesService,
    OfferAccessService,
    OffersQueryService,
    OffersCronService,
    OfferRepository,
    ProductRepository,
    RestaurantRepository,
    UserRepository,
  ],
  exports: [OffersService, OfferRepository],
})
export class OffersModule {}
