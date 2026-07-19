import { Module } from '@nestjs/common';
import { RestaurantService } from './restaurant.service';
import { RestaurantController } from './restaurant.controller';
import { RestaurantRepository, ProductRepository } from 'src/DB/Repositories';
import { RestaurantModel, ProductModel } from 'src/DB/Models';

@Module({
  imports: [RestaurantModel, ProductModel],
  controllers: [RestaurantController],
  providers: [RestaurantService, RestaurantRepository, ProductRepository],
  exports: [RestaurantService, RestaurantRepository, ProductRepository],
})
export class RestaurantModule {}
