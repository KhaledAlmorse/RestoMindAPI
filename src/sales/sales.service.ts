import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isValidObjectId, Types } from 'mongoose';
import { RolesEnum } from 'src/Common/Types';
import { UserType } from 'src/DB/Models';
import { SalesTransactionRepository } from 'src/DB/Repositories';
import { QuerySalesDto } from './dto/query-sales.dto';

@Injectable()
export class SalesService {
  constructor(
    private readonly salesTransactionRepository: SalesTransactionRepository,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  private buildFilters(currentUser: UserType, query: QuerySalesDto) {
    const filters: Record<string, any> = { isDeleted: false };

    // Manager role scoping
    if (currentUser.role === RolesEnum.MANAGER) {
      if (!currentUser.restaurantId) {
        throw new ForbiddenException('Manager is not assigned to a restaurant');
      }
      const managerRestId = currentUser.restaurantId.toString();
      if (query.restaurantId && query.restaurantId !== managerRestId) {
        throw new ForbiddenException(
          'You can only access sales for your own restaurant',
        );
      }
      filters.restaurantId = new Types.ObjectId(managerRestId);
    } else if (query.restaurantId) {
      this.validateObjectId(query.restaurantId);
      filters.restaurantId = new Types.ObjectId(query.restaurantId);
    }

    if (query.productId) {
      this.validateObjectId(query.productId);
      filters.productId = new Types.ObjectId(query.productId);
    }

    if (query.source) {
      filters.source = query.source;
    }

    if (query.startDate || query.endDate) {
      filters.date = {};
      if (query.startDate) {
        const start = new Date(query.startDate);
        if (query.startDate.trim().length === 10) {
          start.setUTCHours(0, 0, 0, 0);
        }
        filters.date.$gte = start;
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        if (query.endDate.trim().length === 10) {
          end.setUTCHours(23, 59, 59, 999);
        }
        filters.date.$lte = end;
      }
    }

    return filters;
  }

  async getSales(currentUser: UserType, query: QuerySalesDto) {
    const filters = this.buildFilters(currentUser, query);
    const limit = query.limit || 10;
    const page = query.page || 1;
    const skip = (page - 1) * limit;

    const result = await this.salesTransactionRepository.findManyPaginated({
      filters,
      skip,
      limit,
      sort: query.sort || 'date',
      order: query.order || 'desc',
      populationArray: [
        { path: 'restaurantId', select: 'name title address' },
        { path: 'productId', select: 'title category price discountedPrice' },
      ],
    });

    return { data: result };
  }

  async getSalesSummary(currentUser: UserType, query: QuerySalesDto) {
    const filters = this.buildFilters(currentUser, query);
    const summary =
      await this.salesTransactionRepository.aggregateSalesSummary(filters);
    return { data: summary };
  }
}
