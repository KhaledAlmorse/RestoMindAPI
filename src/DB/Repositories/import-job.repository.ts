import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { ImportJob, ImportJobType } from '../Models/import-job.model';
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
export class ImportJobRepository extends BaseService<ImportJobType> {
  constructor(
    @InjectModel(ImportJob.name)
    private readonly importJobModel: Model<ImportJobType>,
  ) {
    super(importJobModel);
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

    const query = this.importJobModel
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
      this.importJobModel.countDocuments(filters).exec(),
    ]);

    return {
      items,
      page: Math.floor(skip / limit) + 1,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }
}
