import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RestaurantRepository, UserRepository } from 'src/DB/Repositories';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { isValidObjectId, Types } from 'mongoose';

@Injectable()
export class RestaurantService {
  constructor(
    private readonly restaurantRepository: RestaurantRepository,
    private readonly userRepository: UserRepository,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  async createRestaurant(body: CreateRestaurantDto) {
    const { name, ownerUserId } = body;

    this.validateObjectId(ownerUserId);
    const owner = await this.userRepository.findOne({
      filters: { _id: ownerUserId, isDeleted: false },
    });
    if (!owner) {
      throw new NotFoundException('Owner user not found');
    }

    const existing = await this.restaurantRepository.findOne({
      filters: { name, isDeleted: false },
    });
    if (existing) {
      throw new ConflictException('Restaurant with this name already exists');
    }

    const newRestaurant = await this.restaurantRepository.create({
      ...body,
      ownerUserId: new Types.ObjectId(ownerUserId),
    } as any);

    // Automatically update owner user's restaurantId
    await this.userRepository.update({
      filters: { _id: ownerUserId },
      body: { restaurantId: newRestaurant._id } as any,
    });

    return { data: newRestaurant };
  }

  async findAll(query: { page?: string; limit?: string; search?: string }) {
    const { page = '1', limit = '10', search } = query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const skip = (pageNum - 1) * limitNum;

    const filters: Record<string, any> = { isDeleted: false };

    if (search) {
      filters['name'] = { $regex: search, $options: 'i' };
    }

    const result = await this.restaurantRepository.findManyPaginated({
      filters,
      skip,
      limit: limitNum,
      sort: 'createdAt',
      order: 'desc',
      populationArray: [{ path: 'ownerUserId', select: '-password' }],
    });

    return result;
  }

  async findById(id: string) {
    this.validateObjectId(id);
    const restaurant = await this.restaurantRepository.findOne({
      filters: { _id: id, isDeleted: false },
      populationArray: [{ path: 'ownerUserId', select: '-password' }],
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    return { data: restaurant };
  }

  async updateRestaurant(id: string, body: UpdateRestaurantDto) {
    this.validateObjectId(id);
    const restaurant = await this.restaurantRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    if (body.name) {
      const existing = await this.restaurantRepository.findOne({
        filters: { name: body.name, isDeleted: false },
      });
      if (existing) {
        throw new ConflictException('Restaurant with this name already exists');
      }
    }

    if (body.ownerUserId) {
      this.validateObjectId(body.ownerUserId);
      const owner = await this.userRepository.findOne({
        filters: { _id: body.ownerUserId, isDeleted: false },
      });
      if (!owner) {
        throw new NotFoundException('Owner user not found');
      }
    }

    const updateData: any = { ...body };
    if (body.ownerUserId) {
      updateData.ownerUserId = new Types.ObjectId(body.ownerUserId);
    }

    const updated = await this.restaurantRepository.update({
      filters: { _id: id },
      body: updateData,
    });

    return { data: updated };
  }

  async softDeleteRestaurant(id: string) {
    this.validateObjectId(id);
    const restaurant = await this.restaurantRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    await this.restaurantRepository.update({
      filters: { _id: id },
      body: {
        isDeleted: true,
        deletedAt: new Date(),
      } as any,
    });

    return { message: 'Restaurant deleted successfully' };
  }
}
