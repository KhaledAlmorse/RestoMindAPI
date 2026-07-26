import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isValidObjectId, Types } from 'mongoose';
import {
  IngredientRepository,
  InventoryBatchRepository,
  RestaurantRepository,
  StockTransactionRepository,
  UserRepository,
  WasteEventRepository,
} from 'src/DB/Repositories';
import { CreateBatchDto } from './dto/create-batch.dto';
import { QueryBatchDto } from './dto/query-batch.dto';
import { CreateStockTransactionDto } from './dto/create-stock-transaction.dto';
import { QueryStockTransactionDto } from './dto/query-stock-transaction.dto';
import { CreateWasteEventDto } from './dto/create-waste-event.dto';
import { QueryWasteEventDto } from './dto/query-waste-event.dto';
import {
  StockTransactionTypeEnum,
  WasteReasonEnum,
} from 'src/Common/Types';

@Injectable()
export class InventoryService {
  constructor(
    private readonly inventoryBatchRepository: InventoryBatchRepository,
    private readonly stockTransactionRepository: StockTransactionRepository,
    private readonly wasteEventRepository: WasteEventRepository,
    private readonly ingredientRepository: IngredientRepository,
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

  // --- Batches ---

  async createBatch(dto: CreateBatchDto, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    this.validateObjectId(dto.ingredientId);

    const ingredient = await this.ingredientRepository.findOne({
      filters: {
        _id: new Types.ObjectId(dto.ingredientId),
        restaurantId,
        isDeleted: false,
      },
    });

    if (!ingredient) {
      throw new NotFoundException('Ingredient not found in your restaurant');
    }

    const batch = await this.inventoryBatchRepository.create({
      restaurantId,
      ingredientId: new Types.ObjectId(dto.ingredientId),
      batchNumber: dto.batchNumber.trim(),
      quantityRemaining: dto.quantityRemaining,
      unitCost: dto.unitCost,
      expiryDate: new Date(dto.expiryDate),
      receivedDate: dto.receivedDate ? new Date(dto.receivedDate) : new Date(),
    } as any);

    return { data: batch };
  }

  async getBatches(query: QueryBatchDto, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const { page = '1', limit = '10', ingredientId } = query;

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

    if (ingredientId) {
      this.validateObjectId(ingredientId);
      filters.ingredientId = new Types.ObjectId(ingredientId);
    }

    const result = await this.inventoryBatchRepository.findManyPaginated({
      filters,
      skip,
      limit: limitNum,
      sort: 'createdAt',
      order: 'desc',
      populationArray: ['ingredientId'],
    });

    return result;
  }

  // --- Stock Transactions ---

  async createStockTransaction(
    dto: CreateStockTransactionDto,
    userId: string,
  ) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    this.validateObjectId(dto.ingredientId);

    const ingredient = await this.ingredientRepository.findOne({
      filters: {
        _id: new Types.ObjectId(dto.ingredientId),
        restaurantId,
        isDeleted: false,
      },
    });

    if (!ingredient) {
      throw new NotFoundException('Ingredient not found in your restaurant');
    }

    let batchIdObj: Types.ObjectId | undefined = undefined;
    if (dto.batchId) {
      this.validateObjectId(dto.batchId);
      const batch = await this.inventoryBatchRepository.findOne({
        filters: {
          _id: new Types.ObjectId(dto.batchId),
          restaurantId,
          isDeleted: false,
        },
      });
      if (!batch) {
        throw new NotFoundException('Batch not found in your restaurant');
      }
      batchIdObj = batch._id;
    }

    const transaction = await this.stockTransactionRepository.create({
      restaurantId,
      ingredientId: new Types.ObjectId(dto.ingredientId),
      batchId: batchIdObj ?? null,
      transactionType: dto.transactionType,
      quantity: dto.quantity,
      unit: dto.unit,
      date: dto.date ? new Date(dto.date) : new Date(),
    } as any);

    if (
      dto.transactionType === StockTransactionTypeEnum.WASTE &&
      dto.wasteReason
    ) {
      await this.wasteEventRepository.create({
        restaurantId,
        ingredientId: new Types.ObjectId(dto.ingredientId),
        batchId: batchIdObj ?? null,
        quantity: dto.quantity,
        unit: dto.unit,
        wasteReason: dto.wasteReason,
        estimatedCost: dto.estimatedCost ?? 0,
        date: dto.date ? new Date(dto.date) : new Date(),
      } as any);
    }

    return { data: transaction };
  }

  async getStockTransactions(
    query: QueryStockTransactionDto,
    userId: string,
  ) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const { page = '1', limit = '10', ingredientId, transactionType } = query;

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

    if (ingredientId) {
      this.validateObjectId(ingredientId);
      filters.ingredientId = new Types.ObjectId(ingredientId);
    }

    if (transactionType) {
      filters.transactionType = transactionType;
    }

    const result = await this.stockTransactionRepository.findManyPaginated({
      filters,
      skip,
      limit: limitNum,
      sort: 'date',
      order: 'desc',
      populationArray: ['ingredientId', 'batchId'],
    });

    return result;
  }

  // --- Waste Events ---

  async createWasteEvent(dto: CreateWasteEventDto, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    this.validateObjectId(dto.ingredientId);

    const ingredient = await this.ingredientRepository.findOne({
      filters: {
        _id: new Types.ObjectId(dto.ingredientId),
        restaurantId,
        isDeleted: false,
      },
    });

    if (!ingredient) {
      throw new NotFoundException('Ingredient not found in your restaurant');
    }

    let batchIdObj: Types.ObjectId | undefined = undefined;
    if (dto.batchId) {
      this.validateObjectId(dto.batchId);
      const batch = await this.inventoryBatchRepository.findOne({
        filters: {
          _id: new Types.ObjectId(dto.batchId),
          restaurantId,
          isDeleted: false,
        },
      });
      if (!batch) {
        throw new NotFoundException('Batch not found in your restaurant');
      }
      batchIdObj = batch._id;
    }

    const wasteEvent = await this.wasteEventRepository.create({
      restaurantId,
      ingredientId: new Types.ObjectId(dto.ingredientId),
      batchId: batchIdObj ?? null,
      quantity: dto.quantity,
      unit: dto.unit,
      wasteReason: dto.wasteReason,
      estimatedCost: dto.estimatedCost,
      date: dto.date ? new Date(dto.date) : new Date(),
    } as any);

    // Auto-create ledger row in stock_transactions
    await this.stockTransactionRepository.create({
      restaurantId,
      ingredientId: new Types.ObjectId(dto.ingredientId),
      batchId: batchIdObj ?? null,
      transactionType: StockTransactionTypeEnum.WASTE,
      quantity: dto.quantity,
      unit: dto.unit,
      date: dto.date ? new Date(dto.date) : new Date(),
    } as any);

    return { data: wasteEvent };
  }

  async getWasteEvents(query: QueryWasteEventDto, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const { page = '1', limit = '10', ingredientId, wasteReason } = query;

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

    if (ingredientId) {
      this.validateObjectId(ingredientId);
      filters.ingredientId = new Types.ObjectId(ingredientId);
    }

    if (wasteReason) {
      filters.wasteReason = wasteReason;
    }

    const result = await this.wasteEventRepository.findManyPaginated({
      filters,
      skip,
      limit: limitNum,
      sort: 'date',
      order: 'desc',
      populationArray: ['ingredientId', 'batchId'],
    });

    return result;
  }
}
