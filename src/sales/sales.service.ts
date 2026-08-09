import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isValidObjectId, Types } from 'mongoose';
import { getBusinessDayRange } from 'src/Common/Utils';
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
      // A bare YYYY-MM-DD is a Cairo calendar date, not a UTC one.
      if (query.startDate) {
        const trimmed = query.startDate.trim();
        filters.date.$gte =
          trimmed.length === 10
            ? getBusinessDayRange(trimmed).start
            : new Date(query.startDate);
      }
      if (query.endDate) {
        const trimmed = query.endDate.trim();
        filters.date.$lte =
          trimmed.length === 10
            ? new Date(getBusinessDayRange(trimmed).end.getTime() - 1)
            : new Date(query.endDate);
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
        { path: 'productId', select: 'title category price' },
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
