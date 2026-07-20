import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  RestaurantRepository,
  UserRepository,
  ProductRepository,
} from 'src/DB/Repositories';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { isValidObjectId, Types } from 'mongoose';
import { RolesEnum } from 'src/Common/Types';
import slugify from 'slugify';

@Injectable()
export class RestaurantService {
  constructor(
    private readonly restaurantRepository: RestaurantRepository,
    private readonly userRepository: UserRepository,
    private readonly productRepository: ProductRepository,
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

    // Verify user role is manager
    if (owner.role !== RolesEnum.MANAGER) {
      throw new BadRequestException('Owner must have role "manager"');
    }

    // Verify manager does not already own another active restaurant
    if (owner.restaurantId) {
      const activeRestaurant = await this.restaurantRepository.findOne({
        filters: { _id: owner.restaurantId, isDeleted: false },
      });
      if (activeRestaurant) {
        throw new BadRequestException(
          'Manager is already assigned to a restaurant',
        );
      }
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

    try {
      // Automatically update owner user's restaurantId
      await this.userRepository.update({
        filters: { _id: ownerUserId },
        body: { restaurantId: newRestaurant._id } as any,
      });
    } catch (error) {
      // Rollback restaurant creation if user update fails
      await this.restaurantRepository.update({
        filters: { _id: newRestaurant._id },
        body: { isDeleted: true, deletedAt: new Date() } as any,
      });
      throw error;
    }

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

    const nameChanged = body.name && body.name !== restaurant.name;
    if (body.name) {
      const existing = await this.restaurantRepository.findOne({
        filters: { name: body.name, isDeleted: false, _id: { $ne: id } },
      });
      if (existing) {
        throw new ConflictException('Restaurant with this name already exists');
      }
    }

    const oldOwnerId = restaurant.ownerUserId;
    const ownerChanged =
      body.ownerUserId && body.ownerUserId !== oldOwnerId.toString();

    if (body.ownerUserId) {
      this.validateObjectId(body.ownerUserId);
      const owner = await this.userRepository.findOne({
        filters: { _id: body.ownerUserId, isDeleted: false },
      });
      if (!owner) {
        throw new NotFoundException('Owner user not found');
      }
      if (owner.role !== RolesEnum.MANAGER) {
        throw new BadRequestException('Owner must have role "manager"');
      }
      if (owner.restaurantId) {
        const activeRestaurant = await this.restaurantRepository.findOne({
          filters: { _id: owner.restaurantId, isDeleted: false },
        });
        if (activeRestaurant && activeRestaurant._id.toString() !== id) {
          throw new BadRequestException(
            'Manager is already assigned to another restaurant',
          );
        }
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

    if (ownerChanged) {
      // Clear old owner
      await this.userRepository.update({
        filters: { _id: oldOwnerId },
        body: { restaurantId: null } as any,
      });
      // Set new owner
      await this.userRepository.update({
        filters: { _id: body.ownerUserId },
        body: { restaurantId: new Types.ObjectId(id) } as any,
      });
    }

    // Update product slugs if name changed
    if (nameChanged && body.name) {
      const products = await this.productRepository.findMany({
        filters: { restaurantId: new Types.ObjectId(id), isDeleted: false },
      });
      if (products && products.length > 0) {
        const newRestaurantNameSlug = slugify(body.name, {
          lower: true,
          strict: true,
        });
        for (const prod of products) {
          const productTitleSlug = slugify(prod.title, {
            lower: true,
            strict: true,
          });
          const newSlug = `${newRestaurantNameSlug}-${productTitleSlug}`;
          await this.productRepository.update({
            filters: { _id: prod._id },
            body: { slug: newSlug } as any,
          });
        }
      }
    }

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

    // Clear owner user's restaurantId
    if (restaurant.ownerUserId) {
      await this.userRepository.update({
        filters: { _id: restaurant.ownerUserId },
        body: { restaurantId: null } as any,
      });
    }

    return { message: 'Restaurant deleted successfully' };
  }
}
