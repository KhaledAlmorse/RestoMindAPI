import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRepository } from 'src/DB/Repositories';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { isValidObjectId } from 'mongoose';

@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  // ─── POST /users ─────────────────────────────────────────────────────────────

  async createUser(body: CreateUserDto) {
    const { email } = body;

    const existingUser = await this.userRepository.findOne({
      filters: { email },
    });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    // Password is auto-hashed by Mongoose pre('save') hook
    const newUser = await this.userRepository.create({ ...body });

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

    // Use the model via repository's findMany + custom aggregate for pagination
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

  async updateUser(id: string, body: UpdateUserDto) {
    this.validateObjectId(id);

    const user = await this.userRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.userRepository.update({
      filters: { _id: id },
      body: body as any,
    });

    return {
      data: updated,
    };
  }

  // ─── DELETE /users/:id ────────────────────────────────────────────────────────

  async softDeleteUser(id: string) {
    this.validateObjectId(id);

    const user = await this.userRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userRepository.update({
      filters: { _id: id },
      body: { isDeleted: true } as any,
    });

    return { message: 'User deleted successfully' };
  }
}
