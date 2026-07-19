import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { User, type UserType } from '../Models/user.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

interface PaginatedOptions {
  filters?: Record<string, unknown>;
  select?: string;
  skip: number;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
}

@Injectable()
export class UserRepository extends BaseService<UserType> {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserType>,
  ) {
    super(userModel);
  }

  async findManyPaginated(options: PaginatedOptions) {
    const { filters = {}, select = '', skip, limit, sort, order } = options;
    const sortDirection = order === 'asc' ? 1 : -1;

    const [items, total] = await Promise.all([
      this.userModel
        .find(filters)
        .select(select)
        .sort({ [sort]: sortDirection })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(filters).exec(),
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
