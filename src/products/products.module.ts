import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductRepository, CategoryRepository } from 'src/DB/Repositories';
import { ProductModel, CategoryModel } from 'src/DB/Models';

@Module({
  imports: [ProductModel, CategoryModel],
  controllers: [ProductsController],
  providers: [ProductsService, ProductRepository, CategoryRepository],
  exports: [ProductsService, ProductRepository],
})
export class ProductsModule {}
