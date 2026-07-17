import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Order, OrderType } from '../Models/order.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

interface PaginatedOptions {
  filters?: Record<string, any>;
  select?: string;
  skip: number;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  populationArray?: any[];
}

@Injectable()
export class OrderRepository extends BaseService<OrderType> {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderType>,
  ) {
    super(orderModel);
  }

  async findManyPaginated(options: PaginatedOptions) {
    const {
      filters = {},
      select = '',
      skip,
      limit,
      sort,
      order,
      populationArray = [],
    } = options;
    const sortDirection = order === 'asc' ? 1 : -1;

    const query = this.orderModel
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
      this.orderModel.countDocuments(filters).exec(),
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
