import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { CategoryRepository } from 'src/DB/Repositories';
import { CategoryModel } from 'src/DB/Models';
import { ProductsModule } from 'src/products/products.module';

@Module({
  imports: [CategoryModel, ProductsModule],
  controllers: [CategoriesController],
  providers: [CategoriesService, CategoryRepository],
  exports: [CategoriesService, CategoryRepository],
})
export class CategoriesModule {}
