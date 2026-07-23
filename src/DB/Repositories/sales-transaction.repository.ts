import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { SalesTransaction, SalesTransactionType } from '../Models/sales-transaction.model';
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
export class SalesTransactionRepository extends BaseService<SalesTransactionType> {
  constructor(
    @InjectModel(SalesTransaction.name)
    private readonly salesTransactionModel: Model<SalesTransactionType>,
  ) {
    super(salesTransactionModel);
  }

  async findManyPaginated(options: PaginatedOptions) {
    const {
      filters = {},
      select = '',
      skip,
      limit,
      sort = 'date',
      order = 'desc',
      populationArray = [],
    } = options;
    const sortDirection = order === 'asc' ? 1 : -1;

    const query = this.salesTransactionModel
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
      this.salesTransactionModel.countDocuments(filters).exec(),
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
    const query = this.salesTransactionModel.find(filters);
    for (const pop of populationArray) {
      query.populate(pop);
    }
    return query.exec();
  }

  async aggregateSalesSummary(filters: Record<string, any>) {
    const pipeline: any[] = [
      { $match: filters },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalQuantitySold: { $sum: '$quantitySold' },
          totalGrossRevenue: {
            $sum: { $multiply: ['$quantitySold', '$basePrice'] },
          },
          totalNetRevenue: {
            $sum: { $multiply: ['$quantitySold', '$sellingPrice'] },
          },
          promotionalSalesCount: {
            $sum: {
              $cond: [{ $eq: ['$promotionActive', true] }, '$quantitySold', 0],
            },
          },
          featuredSalesCount: {
            $sum: {
              $cond: [{ $eq: ['$featured', true] }, '$quantitySold', 0],
            },
          },
        },
      },
    ];

    const results = await this.salesTransactionModel.aggregate(pipeline).exec();

    if (!results || results.length === 0) {
      return {
        totalTransactions: 0,
        totalQuantitySold: 0,
        totalGrossRevenue: 0,
        totalNetRevenue: 0,
        totalDiscountsGiven: 0,
        promotionalSalesCount: 0,
        featuredSalesCount: 0,
        averageSellingPrice: 0,
      };
    }

    const res = results[0];
    const totalGrossRevenue = res.totalGrossRevenue || 0;
    const totalNetRevenue = res.totalNetRevenue || 0;
    const totalQuantitySold = res.totalQuantitySold || 0;
    const averageSellingPrice =
      totalQuantitySold > 0 ? totalNetRevenue / totalQuantitySold : 0;

    return {
      totalTransactions: res.totalTransactions || 0,
      totalQuantitySold,
      totalGrossRevenue,
      totalNetRevenue,
      totalDiscountsGiven: totalGrossRevenue - totalNetRevenue,
      promotionalSalesCount: res.promotionalSalesCount || 0,
      featuredSalesCount: res.featuredSalesCount || 0,
      averageSellingPrice,
    };
  }
}
