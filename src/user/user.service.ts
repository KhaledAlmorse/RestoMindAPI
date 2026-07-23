import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  UserRepository,
  RestaurantRepository,
  OfferRepository,
} from 'src/DB/Repositories';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { isValidObjectId, Types } from 'mongoose';
import { RolesEnum } from 'src/Common/Types';
import { UserType } from 'src/DB/Models';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly offerRepository: OfferRepository,
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

    const existingPhone = await this.userRepository.findOne({
      filters: { phone: body.phone, isDeleted: false },
    });
    if (existingPhone) {
      throw new ConflictException('A user with this phone already exists');
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

  async findAll(query: QueryUserDto, currentUser?: UserType) {
    const {
      page = 1,
      limit = 10,
      search,
      role,
      sort = 'createdAt',
      sortBy,
      order = 'desc',
      sortOrder,
      restaurantId,
      isDeleted,
      createdAt,
      updatedAt,
    } = query;

    const currentPage = Math.max(1, page);
    const pageSize = Math.max(1, limit);
    const skip = (currentPage - 1) * pageSize;

    const sortField = sortBy || sort || 'createdAt';
    const sortDir = sortOrder || order || 'desc';

    // Build filter
    const filters: Record<string, unknown> = {};

    if (isDeleted === 'true') {
      filters['isDeleted'] = true;
    } else {
      filters['isDeleted'] = false;
    }

    if (currentUser?.role === RolesEnum.MANAGER) {
      if (!currentUser.restaurantId) {
        throw new ForbiddenException(
          'No restaurant is assigned to your account',
        );
      }
      filters['restaurantId'] = currentUser.restaurantId;
      filters['role'] = RolesEnum.STAFF;
    } else {
      if (role) {
        filters['role'] = role;
      }
      if (restaurantId) {
        this.validateObjectId(restaurantId);
        filters['restaurantId'] = new Types.ObjectId(restaurantId);
      }
    }

    if (search && search.trim() !== '') {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      filters['$or'] = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
      ];
    }

    if (createdAt) {
      const createdDate = new Date(createdAt);
      if (!isNaN(createdDate.getTime())) {
        const startOfDay = new Date(createdDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(createdDate.setHours(23, 59, 59, 999));
        filters['createdAt'] = { $gte: startOfDay, $lte: endOfDay };
      }
    }

    if (updatedAt) {
      const updatedDate = new Date(updatedAt);
      if (!isNaN(updatedDate.getTime())) {
        const startOfDay = new Date(updatedDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(updatedDate.setHours(23, 59, 59, 999));
        filters['updatedAt'] = { $gte: startOfDay, $lte: endOfDay };
      }
    }

    const paginatedResult = await this.userRepository.findManyPaginated({
      filters,
      select: '-password',
      skip,
      limit: pageSize,
      sort: sortField,
      order: sortDir,
    });

    const totalItems = paginatedResult.total;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const hasNextPage = currentPage < totalPages;
    const hasPreviousPage = currentPage > 1;

    return {
      data: paginatedResult.items,
      totalItems,
      totalPages,
      currentPage,
      pageSize,
      hasNextPage,
      hasPreviousPage,
    };
  }

  // ─── GET /users/:id ──────────────────────────────────────────────────────────

  async findById(id: string, currentUser?: UserType) {
    this.validateObjectId(id);

    const user = await this.userRepository.findOne({
      filters: { _id: id, isDeleted: false },
      select: '-password',
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (currentUser?.role === RolesEnum.MANAGER) {
      if (!currentUser.restaurantId) {
        throw new ForbiddenException(
          'No restaurant is assigned to your account',
        );
      }
      if (
        !user.restaurantId ||
        user.restaurantId.toString() !== currentUser.restaurantId.toString() ||
        user.role !== RolesEnum.STAFF
      ) {
        throw new ForbiddenException(
          'Managers can only view staff belonging to their own restaurant',
        );
      }
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

    // Security check: Manager updating Admin/Manager/Other restaurant staff
    if (currentUser.role === RolesEnum.MANAGER) {
      if (!currentUser.restaurantId) {
        throw new ForbiddenException(
          'No restaurant is assigned to your account',
        );
      }
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
        user.role === RolesEnum.STAFF &&
        (!user.restaurantId ||
          user.restaurantId.toString() !== currentUser.restaurantId.toString())
      ) {
        throw new ForbiddenException(
          'Managers can only update staff belonging to their own restaurant',
        );
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
        body.restaurantId !== currentUser.restaurantId.toString()
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

    // Business Rule: Check if manager is currently assigned as owner of an active restaurant
    const activeOwnedRestaurant = await this.restaurantRepository.findOne({
      filters: { ownerUserId: new Types.ObjectId(id), isDeleted: false },
    });

    if (activeOwnedRestaurant) {
      throw new ConflictException({
        message:
          'Unable to delete this manager because they are currently assigned as the owner of an active restaurant. Please delete the restaurant or transfer its ownership before deleting this manager.',
        code: 'MANAGER_HAS_ACTIVE_RESTAURANT',
      });
    }

    await this.userRepository.update({
      filters: { _id: id },
      body: { isDeleted: true, restaurantId: null } as any,
    });

    return { message: 'User deleted successfully' };
  }
}
