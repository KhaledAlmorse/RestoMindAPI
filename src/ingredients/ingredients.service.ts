import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isValidObjectId, Types } from 'mongoose';
import {
  IngredientRepository,
  RecipeRepository,
  RestaurantRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';
import { QueryIngredientDto } from './dto/query-ingredient.dto';

@Injectable()
export class IngredientsService {
  constructor(
    private readonly ingredientRepository: IngredientRepository,
    private readonly userRepository: UserRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly recipeRepository: RecipeRepository,
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

  async createIngredient(dto: CreateIngredientDto, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);

    const existing = await this.ingredientRepository.findOne({
      filters: {
        restaurantId,
        ingredientCode: dto.ingredientCode.trim(),
        isDeleted: false,
      },
    });

    if (existing) {
      throw new ConflictException(
        'Ingredient with this code already exists in your restaurant',
      );
    }

    const ingredient = await this.ingredientRepository.create({
      restaurantId,
      ingredientCode: dto.ingredientCode.trim(),
      name: dto.name.trim(),
      unit: dto.unit,
      shelfLifeDays: dto.shelfLifeDays,
      minimumStock: dto.minimumStock ?? 0,
      safetyStock: dto.safetyStock ?? 0,
    } as any);

    return { data: ingredient };
  }

  async getIngredients(query: QueryIngredientDto, userId: string) {
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
      filters.$or = [
        { name: { $regex: search, $options: 'i' } },
        { ingredientCode: { $regex: search, $options: 'i' } },
      ];
    }

    const result = await this.ingredientRepository.findManyPaginated({
      filters,
      skip,
      limit: limitNum,
      sort: 'createdAt',
      order: 'desc',
    });

    return result;
  }

  async getIngredientById(id: string, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    this.validateObjectId(id);

    const ingredient = await this.ingredientRepository.findOne({
      filters: { _id: new Types.ObjectId(id), isDeleted: false },
    });

    if (!ingredient) {
      throw new NotFoundException('Ingredient not found');
    }

    if (ingredient.restaurantId.toString() !== restaurantId.toString()) {
      throw new ForbiddenException(
        'You can only access ingredients belonging to your restaurant',
      );
    }

    return { data: ingredient };
  }

  async updateIngredient(id: string, dto: UpdateIngredientDto, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    this.validateObjectId(id);

    const ingredient = await this.ingredientRepository.findOne({
      filters: { _id: new Types.ObjectId(id), isDeleted: false },
    });

    if (!ingredient) {
      throw new NotFoundException('Ingredient not found');
    }

    if (ingredient.restaurantId.toString() !== restaurantId.toString()) {
      throw new ForbiddenException(
        'You can only update ingredients belonging to your restaurant',
      );
    }

    if (dto.ingredientCode) {
      const existing = await this.ingredientRepository.findOne({
        filters: {
          restaurantId,
          ingredientCode: dto.ingredientCode.trim(),
          isDeleted: false,
          _id: { $ne: new Types.ObjectId(id) },
        },
      });

      if (existing) {
        throw new ConflictException(
          'Ingredient with this code already exists in your restaurant',
        );
      }
    }

    const updateBody: Record<string, any> = { ...dto };
    if (dto.ingredientCode)
      updateBody.ingredientCode = dto.ingredientCode.trim();
    if (dto.name) updateBody.name = dto.name.trim();

    const updated = await this.ingredientRepository.update({
      filters: { _id: new Types.ObjectId(id) },
      body: updateBody,
    });

    return { data: updated };
  }

  async deleteIngredient(id: string, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    this.validateObjectId(id);

    const ingredient = await this.ingredientRepository.findOne({
      filters: { _id: new Types.ObjectId(id), isDeleted: false },
    });

    if (!ingredient) {
      throw new NotFoundException('Ingredient not found');
    }

    if (ingredient.restaurantId.toString() !== restaurantId.toString()) {
      throw new ForbiddenException(
        'You can only delete ingredients belonging to your restaurant',
      );
    }

    const activeRecipeUsage = await this.recipeRepository.findOne({
      filters: {
        restaurantId,
        isDeleted: false,
        'ingredients.ingredientId': new Types.ObjectId(id),
      },
    });

    if (activeRecipeUsage) {
      throw new BadRequestException(
        'Cannot delete ingredient because it is currently used in one or more active recipes',
      );
    }

    await this.ingredientRepository.update({
      filters: { _id: new Types.ObjectId(id) },
      body: {
        isDeleted: true,
        deletedAt: new Date(),
      } as any,
    });

    return { message: 'Ingredient deleted successfully' };
  }
}
