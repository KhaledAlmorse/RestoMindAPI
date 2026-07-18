import { Module } from '@nestjs/common';
import { RestaurantService } from './restaurant.service';
import { RestaurantController } from './restaurant.controller';
import { RestaurantRepository } from 'src/DB/Repositories';
import { RestaurantModel } from 'src/DB/Models';

@Module({
  imports: [RestaurantModel],
  controllers: [RestaurantController],
  providers: [RestaurantService, RestaurantRepository],
  exports: [RestaurantService, RestaurantRepository],
})
export class RestaurantModule {}
