import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Category, CategoryType } from '../Models/category.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class CategoryRepository extends BaseService<CategoryType> {
  constructor(
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryType>,
  ) {
    super(categoryModel);
  }
}
