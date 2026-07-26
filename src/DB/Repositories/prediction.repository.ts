import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Prediction, PredictionType } from '../Models/prediction.model';
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
export class PredictionRepository extends BaseService<PredictionType> {
  constructor(
    @InjectModel(Prediction.name)
    private readonly predictionModel: Model<PredictionType>,
  ) {
    super(predictionModel);
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

    const query = this.predictionModel
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
      this.predictionModel.countDocuments(filters).exec(),
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
    sort?: Record<string, any>;
  }): Promise<PredictionType[]> {
    const { filters = {}, populationArray = [], sort } = options;
    const query = this.predictionModel.find(filters);
    if (sort) {
      query.sort(sort);
    }
    for (const pop of populationArray) {
      query.populate(pop);
    }
    return query.exec();
  }
}
