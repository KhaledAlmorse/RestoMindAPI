import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isValidObjectId, Types } from 'mongoose';
import {
  RestaurantRepository,
  SupplierRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { QuerySupplierDto } from './dto/query-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly supplierRepository: SupplierRepository,
    private readonly userRepository: UserRepository,
    private readonly restaurantRepository: RestaurantRepository,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  private async getManagerRestaurantId(
    userId: string,
  ): Promise<Types.ObjectId> {
    this.validateObjectId(userId);
    const user = await this.userRepository.findOne({
      filters: { _id: new Types.ObjectId(userId), isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.restaurantId) {
      return new Types.ObjectId(user.restaurantId.toString());
    }

    const restaurant = await this.restaurantRepository.findOne({
      filters: { ownerUserId: new Types.ObjectId(userId), isDeleted: false },
    });

    if (!restaurant) {
      throw new ForbiddenException(
        'You are not assigned to a restaurant or do not own one',
      );
    }

    return restaurant._id;
  }

  async createSupplier(dto: CreateSupplierDto, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);

    const existing = await this.supplierRepository.findOne({
      filters: {
        restaurantId,
        name: dto.name.trim(),
        isDeleted: false,
      },
    });

    if (existing) {
      throw new ConflictException(
        'Supplier with this name already exists in your restaurant',
      );
    }

    const email = dto.email ? dto.email.trim() : '';
    const phone = dto.phone ? dto.phone.trim() : '';

    const supplier = await this.supplierRepository.create({
      restaurantId,
      name: dto.name.trim(),
      email,
      phone,
      leadTimeDays: dto.leadTimeDays ?? 1,
    } as any);

    return { data: supplier };
  }

  async getSuppliers(query: QuerySupplierDto, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const { page = '1', limit = '10', search } = query;

    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);
    const pageNum = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const limitNum =
      Number.isNaN(parsedLimit) || parsedLimit < 1 ? 10 : parsedLimit;
    const skip = (pageNum - 1) * limitNum;

    const filters: Record<string, any> = {
      restaurantId,
      isDeleted: false,
    };

    if (search) {
      filters.name = { $regex: search, $options: 'i' };
    }

    const result = await this.supplierRepository.findManyPaginated({
      filters,
      skip,
      limit: limitNum,
      sort: 'createdAt',
      order: 'desc',
    });

    return result;
  }
}
