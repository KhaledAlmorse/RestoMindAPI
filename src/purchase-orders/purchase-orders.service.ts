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
  PurchaseOrderRepository,
  RestaurantRepository,
  StockTransactionRepository,
  SupplierRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';
import {
  PurchaseOrderStatusEnum,
  StockTransactionTypeEnum,
} from 'src/Common/Types';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly purchaseOrderRepository: PurchaseOrderRepository,
    private readonly supplierRepository: SupplierRepository,
    private readonly ingredientRepository: IngredientRepository,
    private readonly inventoryBatchRepository: InventoryBatchRepository,
    private readonly stockTransactionRepository: StockTransactionRepository,
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

  async createPurchaseOrder(dto: CreatePurchaseOrderDto, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    this.validateObjectId(dto.supplierId);

    const supplier = await this.supplierRepository.findOne({
      filters: {
        _id: new Types.ObjectId(dto.supplierId),
        restaurantId,
        isDeleted: false,
      },
    });

    if (!supplier) {
      throw new NotFoundException('Supplier not found in your restaurant');
    }

    for (const item of dto.items) {
      this.validateObjectId(item.ingredientId);
      const ingredient = await this.ingredientRepository.findOne({
        filters: {
          _id: new Types.ObjectId(item.ingredientId),
          restaurantId,
          isDeleted: false,
        },
      });
      if (!ingredient) {
        throw new NotFoundException(
          `Ingredient ${item.ingredientId} not found in your restaurant`,
        );
      }
    }

    const po = await this.purchaseOrderRepository.create({
      restaurantId,
      supplierId: new Types.ObjectId(dto.supplierId),
      items: dto.items.map((i) => ({
        ingredientId: new Types.ObjectId(i.ingredientId),
        quantity: i.quantity,
        unit: i.unit,
        unitCost: i.unitCost,
      })),
      status: dto.status ?? PurchaseOrderStatusEnum.DRAFT,
      expectedDeliveryDate: dto.expectedDeliveryDate
        ? new Date(dto.expectedDeliveryDate)
        : null,
      createdBy: new Types.ObjectId(userId),
    } as any);

    return { data: po };
  }

  async getPurchaseOrders(query: QueryPurchaseOrderDto, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const { page = '1', limit = '10', status, supplierId } = query;

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

    if (status) {
      filters.status = status;
    }

    if (supplierId) {
      this.validateObjectId(supplierId);
      filters.supplierId = new Types.ObjectId(supplierId);
    }

    const result = await this.purchaseOrderRepository.findManyPaginated({
      filters,
      skip,
      limit: limitNum,
      sort: 'createdAt',
      order: 'desc',
      populationArray: ['supplierId', 'items.ingredientId', 'createdBy'],
    });

    return result;
  }

  async receivePurchaseOrder(id: string, userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    this.validateObjectId(id);

    const po = await this.purchaseOrderRepository.findOne({
      filters: {
        _id: new Types.ObjectId(id),
        restaurantId,
        isDeleted: false,
      },
    });

    if (!po) {
      throw new NotFoundException('Purchase order not found');
    }

    if (po.status === PurchaseOrderStatusEnum.RECEIVED) {
      throw new BadRequestException('Purchase order is already received');
    }

    if (po.status === PurchaseOrderStatusEnum.CANCELLED) {
      throw new BadRequestException(
        'Cannot receive a cancelled purchase order',
      );
    }

    const createdBatches: any[] = [];
    const timestamp = Date.now();

    for (let index = 0; index < po.items.length; index++) {
      const item = po.items[index];
      const ingredient = await this.ingredientRepository.findOne({
        filters: {
          _id: item.ingredientId,
          restaurantId,
          isDeleted: false,
        },
      });

      const shelfLifeDays = ingredient?.shelfLifeDays ?? 30;
      const expiryDate = new Date(
        Date.now() + shelfLifeDays * 24 * 60 * 60 * 1000,
      );
      const batchNumber = `PO-${po._id.toString().slice(-6)}-${timestamp.toString().slice(-4)}-${index + 1}`;

      const batch = await this.inventoryBatchRepository.create({
        restaurantId,
        ingredientId: item.ingredientId,
        batchNumber,
        quantityRemaining: item.quantity,
        unitCost: item.unitCost,
        expiryDate,
        receivedDate: new Date(),
      } as any);

      await this.stockTransactionRepository.create({
        restaurantId,
        ingredientId: item.ingredientId,
        batchId: batch._id,
        transactionType: StockTransactionTypeEnum.PURCHASE,
        quantity: item.quantity,
        unit: item.unit,
        date: new Date(),
      } as any);

      createdBatches.push(batch);
    }

    const updatedPo = await this.purchaseOrderRepository.update({
      filters: { _id: po._id },
      body: { status: PurchaseOrderStatusEnum.RECEIVED } as any,
    });

    return {
      message: 'Purchase order received successfully',
      data: updatedPo,
      createdBatches,
    };
  }

  async updatePurchaseOrderStatus(
    id: string,
    newStatus: PurchaseOrderStatusEnum,
    userId: string,
  ) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    this.validateObjectId(id);

    const po = await this.purchaseOrderRepository.findOne({
      filters: {
        _id: new Types.ObjectId(id),
        restaurantId,
        isDeleted: false,
      },
    });

    if (!po) {
      throw new NotFoundException('Purchase order not found');
    }

    if (po.status === PurchaseOrderStatusEnum.RECEIVED) {
      throw new BadRequestException(
        'Cannot update status of a received purchase order',
      );
    }

    if (po.status === PurchaseOrderStatusEnum.CANCELLED) {
      throw new BadRequestException(
        'Cannot update status of a cancelled purchase order',
      );
    }

    if (newStatus === PurchaseOrderStatusEnum.RECEIVED) {
      return this.receivePurchaseOrder(id, userId);
    }

    const updatedPo = await this.purchaseOrderRepository.update({
      filters: { _id: po._id },
      body: { status: newStatus } as any,
    });

    return {
      message: `Purchase order status updated to ${newStatus}`,
      data: updatedPo,
    };
  }
}
