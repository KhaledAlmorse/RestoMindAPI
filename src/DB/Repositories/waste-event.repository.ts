import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { WasteEvent, WasteEventType } from '../Models/waste-event.model';
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
export class WasteEventRepository extends BaseService<WasteEventType> {
  constructor(
    @InjectModel(WasteEvent.name)
    private readonly wasteEventModel: Model<WasteEventType>,
  ) {
    super(wasteEventModel);
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

    const query = this.wasteEventModel
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
      this.wasteEventModel.countDocuments(filters).exec(),
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
    const query = this.wasteEventModel.find(filters);
    for (const pop of populationArray) {
      query.populate(pop);
    }
    return query.exec();
  }
}
