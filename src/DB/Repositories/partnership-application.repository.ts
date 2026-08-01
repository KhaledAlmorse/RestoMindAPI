import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import {
  PartnershipApplication,
  PartnershipApplicationType,
} from '../Models/partnership-application.model';
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
export class PartnershipApplicationRepository extends BaseService<PartnershipApplicationType> {
  constructor(
    @InjectModel(PartnershipApplication.name)
    private readonly partnershipApplicationModel: Model<PartnershipApplicationType>,
  ) {
    super(partnershipApplicationModel);
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

    const query = this.partnershipApplicationModel
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
      this.partnershipApplicationModel.countDocuments(filters).exec(),
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
    sort?: string;
    order?: 'asc' | 'desc';
  }) {
    const { filters = {}, populationArray = [], sort, order } = options;
    const query = this.partnershipApplicationModel.find(filters);
    if (sort) {
      const sortDirection = order === 'asc' ? 1 : -1;
      query.sort({ [sort]: sortDirection });
    }
    for (const pop of populationArray) {
      query.populate(pop);
    }
    return query.exec();
  }
}
