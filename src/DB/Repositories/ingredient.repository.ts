import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Ingredient, IngredientType } from '../Models/ingredient.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

interface PaginatedOptions {
  filters?: Record<string, any>;
  select?: string;
  skip: number;
  limit: number;
  sort?: string;
  order?: 'asc' | 'desc';
  populationArray?: any[];
}

@Injectable()
export class IngredientRepository extends BaseService<IngredientType> {
  constructor(
    @InjectModel(Ingredient.name)
    private readonly ingredientModel: Model<IngredientType>,
  ) {
    super(ingredientModel);
  }

  async findManyPaginated(options: PaginatedOptions) {
    const {
      filters = {},
      select = '',
      skip,
      limit,
      sort = 'createdAt',
      order = 'desc',
      populationArray = [],
    } = options;
    const sortDirection = order === 'asc' ? 1 : -1;

    const query = this.ingredientModel
      .find(filters)
      .select(select)
      .sort({ [sort]: sortDirection })
      .skip(skip)
      .limit(limit);

    for (const pop of populationArray) {
      query.populate(pop);
    }

    const [items, total] = await Promise.all([
      query.exec(),
      this.ingredientModel.countDocuments(filters).exec(),
    ]);

    return {
      items,
      page: Math.floor(skip / limit) + 1,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findMany(options: {
    filters?: Record<string, any>;
    populationArray?: any[];
  }) {
    const { filters = {}, populationArray = [] } = options;
    const query = this.ingredientModel.find(filters);
    for (const pop of populationArray) {
      query.populate(pop);
    }
    return query.exec();
  }
}
