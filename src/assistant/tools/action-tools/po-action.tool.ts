import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ToolRegistryService, ToolContext } from '../tool-registry.service';
import { PurchaseOrderRepository, SupplierRepository } from 'src/DB/Repositories';
import { PurchaseOrderStatusEnum, PurchaseOrderSourceEnum, IngredientUnitEnum } from 'src/Common/Types';
import { Types } from 'mongoose';

const PurchaseOrderItemSchema = z.object({
  ingredientId: z.string(),
  quantity: z.number().min(1),
  unit: z.nativeEnum(IngredientUnitEnum),
  unitCost: z.number().min(0),
});

const CreatePurchaseOrderSchema = z.object({
  supplierId: z.string(),
  items: z.array(PurchaseOrderItemSchema).min(1),
  expectedDeliveryDays: z.number().default(2),
});

@Injectable()
export class PurchaseOrderActionTool implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly poRepo: PurchaseOrderRepository,
    private readonly supplierRepo: SupplierRepository,
  ) {}

  onModuleInit() {
    this.toolRegistry.registerTool({
      name: 'createPurchaseOrder',
      description: 'Drafts a new purchase order for ingredient suppliers.',
      schema: CreatePurchaseOrderSchema,
      requiresApproval: true,
      handler: (params, context) => this.createPurchaseOrder(params, context),
    });
  }

  async createPurchaseOrder(params: z.infer<typeof CreatePurchaseOrderSchema>, context: ToolContext) {
    const { supplierId, items, expectedDeliveryDays } = params;
    const { restaurantId, userId } = context;

    const supplier = await this.supplierRepo.findOne({
      filters: { _id: new Types.ObjectId(supplierId), restaurantId, isDeleted: false } as any,
    });
    if (!supplier) {
      throw new Error(`Supplier [${supplierId}] not found.`);
    }

    const expectedDeliveryDate = new Date();
    expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + expectedDeliveryDays);

    const po = await this.poRepo.create({
      restaurantId,
      supplierId: supplier._id,
      items: items.map((item) => ({
        ingredientId: new Types.ObjectId(item.ingredientId) as any,
        quantity: item.quantity,
        unit: item.unit,
        unitCost: item.unitCost,
      })),
      status: PurchaseOrderStatusEnum.DRAFT,
      source: PurchaseOrderSourceEnum.AI_FORECAST,
      expectedDeliveryDate,
      createdBy: userId,
      isDeleted: false,
    });

    return {
      success: true,
      purchaseOrderId: po._id,
      supplierName: supplier.name,
      status: po.status,
      itemsCount: items.length,
      expectedDeliveryDate,
    };
  }
}
