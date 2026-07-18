import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductRepository, CategoryRepository } from 'src/DB/Repositories';
import { ProductModel, CategoryModel } from 'src/DB/Models';
import { RestaurantModule } from 'src/restaurant/restaurant.module';

@Module({
  imports: [ProductModel, CategoryModel, RestaurantModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductRepository, CategoryRepository],
  exports: [ProductsService, ProductRepository],
})
export class ProductsModule {}
