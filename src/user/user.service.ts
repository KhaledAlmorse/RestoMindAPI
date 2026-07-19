import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRepository, RestaurantRepository } from 'src/DB/Repositories';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { isValidObjectId, Types } from 'mongoose';
import { RolesEnum } from 'src/Common/Types';
import { UserType } from 'src/DB/Models';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly restaurantRepository: RestaurantRepository,
  ) {}

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  // ─── POST /users ─────────────────────────────────────────────────────────────

  async createUser(body: CreateUserDto, currentUser: UserType) {
    const { email } = body;

    // Prevent duplicate email
    const existingUser = await this.userRepository.findOne({
      filters: { email: email.toLowerCase(), isDeleted: false },
    });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    // Role-based validations
    if (currentUser.role === RolesEnum.MANAGER) {
      if (body.role === RolesEnum.ADMIN || body.role === RolesEnum.MANAGER) {
        throw new ForbiddenException(
          'Managers cannot create admin or manager users',
        );
      }
      if (
        body.restaurantId &&
        body.restaurantId !== currentUser.restaurantId?.toString()
      ) {
        throw new ForbiddenException(
          'Managers can only assign users to their own restaurant',
        );
      }
      if (body.role === RolesEnum.STAFF) {
        body.restaurantId = currentUser.restaurantId?.toString();
      }
    }

    if (body.restaurantId) {
      this.validateObjectId(body.restaurantId);
      const restaurant = await this.restaurantRepository.findOne({
        filters: { _id: body.restaurantId, isDeleted: false },
      });
      if (!restaurant) {
        throw new NotFoundException('Restaurant not found');
      }
    }

    const createData: any = { ...body, email: email.toLowerCase() };
    if (body.restaurantId) {
      createData.restaurantId = new Types.ObjectId(body.restaurantId);
    }
    const newUser = await this.userRepository.create(createData);

    return { data: newUser };
  }

  // ─── GET /users ───────────────────────────────────────────────────────────────

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    sort?: string;
    order?: 'asc' | 'desc';
  }) {
    const {
      page = 1,
      limit = 10,
      search,
      role,
      sort = 'createdAt',
      order = 'desc',
    } = query;

    const pageNum = Math.max(1, page);
    const limitNum = Math.max(1, limit);
    const skip = (pageNum - 1) * limitNum;

    // Build filter — always exclude soft-deleted users
    const filters: Record<string, unknown> = { isDeleted: false };

    if (role) {
      filters['role'] = role;
    }

    if (search) {
      filters['$or'] = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const users = await this.userRepository.findManyPaginated({
      filters,
      select: '-password',
      skip,
      limit: limitNum,
      sort,
      order,
    });

    return {
      data: users,
    };
  }

  // ─── GET /users/:id ──────────────────────────────────────────────────────────

  async findById(id: string) {
    this.validateObjectId(id);

    const user = await this.userRepository.findOne({
      filters: { _id: id, isDeleted: false },
      select: '-password',
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      data: user,
    };
  }

  // ─── PATCH /users/:id ────────────────────────────────────────────────────────

  async updateUser(id: string, body: UpdateUserDto, currentUser: UserType) {
    this.validateObjectId(id);

    const user = await this.userRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Security check: Admin updating Admin
    if (
      user.role === RolesEnum.ADMIN &&
      currentUser.role === RolesEnum.ADMIN &&
      id !== currentUser._id.toString()
    ) {
      throw new ForbiddenException(
        'Administrators cannot update other administrators',
      );
    }

    // Security check: Manager updating Admin/Manager
    if (currentUser.role === RolesEnum.MANAGER) {
      if (user.role === RolesEnum.ADMIN) {
        throw new ForbiddenException('Managers cannot update administrators');
      }
      if (
        user.role === RolesEnum.MANAGER &&
        id !== currentUser._id.toString()
      ) {
        throw new ForbiddenException('Managers cannot update other managers');
      }
      if (
        body.role &&
        (body.role === RolesEnum.ADMIN || body.role === RolesEnum.MANAGER)
      ) {
        throw new ForbiddenException(
          'Managers cannot assign admin or manager roles',
        );
      }
      if (
        body.restaurantId &&
        body.restaurantId !== currentUser.restaurantId?.toString()
      ) {
        throw new ForbiddenException(
          'Managers can only assign users to their own restaurant',
        );
      }
    }

    // Validate duplicate email
    if (body.email) {
      const existingEmail = await this.userRepository.findOne({
        filters: {
          email: body.email.toLowerCase(),
          isDeleted: false,
          _id: { $ne: id },
        },
      });
      if (existingEmail) {
        throw new ConflictException('Email already in use');
      }
    }

    // Validate restaurant existence
    if (body.restaurantId) {
      this.validateObjectId(body.restaurantId);
      const restaurant = await this.restaurantRepository.findOne({
        filters: { _id: body.restaurantId, isDeleted: false },
      });
      if (!restaurant) {
        throw new NotFoundException('Restaurant not found');
      }
    }

    const updateData: any = { ...body };
    if (body.email) {
      updateData.email = body.email.toLowerCase();
    }
    if (body.restaurantId) {
      updateData.restaurantId = new Types.ObjectId(body.restaurantId);
    } else if (body.restaurantId === null) {
      updateData.restaurantId = null;
    }

    const updated = await this.userRepository.update({
      filters: { _id: id },
      body: updateData,
    });

    return {
      data: updated,
    };
  }

  // ─── DELETE /users/:id ────────────────────────────────────────────────────────

  async softDeleteUser(id: string, currentUser: UserType) {
    this.validateObjectId(id);

    if (id === currentUser._id.toString()) {
      throw new BadRequestException('You cannot delete your own account');
    }

    const user = await this.userRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Security check: Admin deleting Admin
    if (user.role === RolesEnum.ADMIN && currentUser.role === RolesEnum.ADMIN) {
      throw new ForbiddenException(
        'Administrators cannot delete other administrators',
      );
    }

    // Security check: Manager deleting Admin/Manager
    if (currentUser.role === RolesEnum.MANAGER) {
      if (user.role === RolesEnum.ADMIN) {
        throw new ForbiddenException('Managers cannot delete administrators');
      }
      if (user.role === RolesEnum.MANAGER) {
        throw new ForbiddenException('Managers cannot delete other managers');
      }
    }

    await this.userRepository.update({
      filters: { _id: id },
      body: { isDeleted: true } as any,
    });

    return { message: 'User deleted successfully' };
  }
}
