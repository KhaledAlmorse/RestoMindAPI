import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { SupplierAutoDraftService } from './supplier-auto-draft.service';
import {
  IngredientRepository,
  InventoryBatchRepository,
  PurchaseOrderRepository,
  RecipeRepository,
  SupplierRepository,
} from 'src/DB/Repositories';
import { PredictionRepository } from 'src/DB/Repositories/prediction.repository';
import {
  IngredientUnitEnum,
  PurchaseOrderStatusEnum,
  PurchaseOrderSourceEnum,
} from 'src/Common/Types';

describe('SupplierAutoDraftService - Phase 6 Business Logic Tests', () => {
  let service: SupplierAutoDraftService;
  let mockPredictionRepo: any;
  let mockRecipeRepo: any;
  let mockIngredientRepo: any;
  let mockInventoryBatchRepo: any;
  let mockPurchaseOrderRepo: any;
  let mockSupplierRepo: any;

  const mockRestaurantId = new Types.ObjectId();
  const mockUserId = new Types.ObjectId();
  const mockProductId = new Types.ObjectId();
  const mockIngredientId = new Types.ObjectId();
  const mockSupplierId = new Types.ObjectId();
  const targetWeek = '2026-07-27';

  beforeEach(async () => {
    mockPredictionRepo = {
      findMany: jest.fn(),
    };
    mockRecipeRepo = {
      findOne: jest.fn(),
    };
    mockIngredientRepo = {
      findOne: jest.fn(),
    };
    mockInventoryBatchRepo = {
      findMany: jest.fn(),
    };
    mockPurchaseOrderRepo = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    mockSupplierRepo = {
      findMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierAutoDraftService,
        { provide: PredictionRepository, useValue: mockPredictionRepo },
        { provide: RecipeRepository, useValue: mockRecipeRepo },
        { provide: IngredientRepository, useValue: mockIngredientRepo },
        { provide: InventoryBatchRepository, useValue: mockInventoryBatchRepo },
        { provide: PurchaseOrderRepository, useValue: mockPurchaseOrderRepo },
        { provide: SupplierRepository, useValue: mockSupplierRepo },
      ],
    }).compile();

    service = module.get<SupplierAutoDraftService>(SupplierAutoDraftService);
  });

  it('should compute exact recipe conversion formula (120 orders * 0.20 kg / 1.0 yield = 24 kg required)', async () => {
    // 120 predicted orders
    mockPredictionRepo.findMany.mockResolvedValue([
      {
        restaurantId: mockRestaurantId,
        productId: mockProductId,
        predictedOrders: 120,
        targetWeek,
      },
    ]);

    // Recipe: 0.20 kg per portion, 100% yield
    mockRecipeRepo.findOne.mockResolvedValue({
      restaurantId: mockRestaurantId,
      productId: mockProductId,
      ingredients: [
        {
          ingredientId: mockIngredientId,
          quantityPerPortion: 0.2,
          unit: IngredientUnitEnum.KG,
          yieldPercentage: 100,
        },
      ],
    });

    mockIngredientRepo.findOne.mockResolvedValue({
      _id: mockIngredientId,
      name: 'Flour',
      ingredientCode: 'ING001',
      unit: IngredientUnitEnum.KG,
      supplierId: mockSupplierId,
    });

    // 0 current batch stock, 0 incoming sent POs -> 24 kg shortfall
    mockInventoryBatchRepo.findMany.mockResolvedValue([]);
    mockPurchaseOrderRepo.findMany.mockResolvedValue([]);

    mockPurchaseOrderRepo.create.mockImplementation((dto: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...dto }),
    );

    const result = await service.generateAutoDrafts(
      mockRestaurantId,
      targetWeek,
      mockUserId,
    );

    expect(result.draftPurchaseOrders).toHaveLength(1);
    const createdPO = result.draftPurchaseOrders[0];

    // Verification: status MUST be draft, source MUST be ai_forecast
    expect(createdPO.status).toBe(PurchaseOrderStatusEnum.DRAFT);
    expect(createdPO.source).toBe(PurchaseOrderSourceEnum.AI_FORECAST);

    // Quantity MUST be exactly 24 kg
    expect(createdPO.items[0].quantity).toBe(24);
    expect(result.unassignedShortfalls).toHaveLength(0);
  });

  it('should handle missing supplier gracefully without crashing and add to unassignedShortfalls', async () => {
    mockPredictionRepo.findMany.mockResolvedValue([
      {
        restaurantId: mockRestaurantId,
        productId: mockProductId,
        predictedOrders: 50,
        targetWeek,
      },
    ]);

    mockRecipeRepo.findOne.mockResolvedValue({
      restaurantId: mockRestaurantId,
      productId: mockProductId,
      ingredients: [
        {
          ingredientId: mockIngredientId,
          quantityPerPortion: 1,
          unit: IngredientUnitEnum.KG,
          yieldPercentage: 100,
        },
      ],
    });

    // Ingredient has NO supplierId
    mockIngredientRepo.findOne.mockResolvedValue({
      _id: mockIngredientId,
      name: 'Saffron',
      ingredientCode: 'ING999',
      unit: IngredientUnitEnum.KG,
      supplierId: null,
    });

    mockInventoryBatchRepo.findMany.mockResolvedValue([]);
    mockPurchaseOrderRepo.findMany.mockResolvedValue([]);
    mockPurchaseOrderRepo.findOne.mockResolvedValue(null);
    mockSupplierRepo.findMany.mockResolvedValue([]); // No default supplier

    const result = await service.generateAutoDrafts(
      mockRestaurantId,
      targetWeek,
      mockUserId,
    );

    // Should NOT throw, draftPurchaseOrders should be empty, unassignedShortfalls should contain Saffron
    expect(result.draftPurchaseOrders).toHaveLength(0);
    expect(result.unassignedShortfalls).toHaveLength(1);
    expect(result.unassignedShortfalls[0].ingredientCode).toBe('ING999');
    expect(result.unassignedShortfalls[0].shortfall).toBe(50);
  });

  it('updates an existing AI draft instead of creating a duplicate', async () => {
    const supplierId = new Types.ObjectId();
    const ingredientId = new Types.ObjectId();
    const existingPoId = new Types.ObjectId();

    mockPredictionRepo.findMany.mockResolvedValue([
      { productId: new Types.ObjectId(), predictedOrders: 100 },
    ]);
    mockRecipeRepo.findOne.mockResolvedValue({
      ingredients: [{ ingredientId, quantityPerPortion: 2, yieldPercentage: 100 }],
    });
    mockIngredientRepo.findOne.mockResolvedValue({
      _id: ingredientId,
      name: 'Flour',
      ingredientCode: 'FLR',
      unit: 'kg',
      supplierId,
    });
    mockInventoryBatchRepo.findMany.mockResolvedValue([]);
    mockPurchaseOrderRepo.findMany.mockResolvedValue([]);
    // An AI draft for this supplier/week already exists.
    mockPurchaseOrderRepo.findOne.mockResolvedValue({
      _id: existingPoId,
      supplierId,
      items: [],
    });
    mockPurchaseOrderRepo.update.mockResolvedValue({ _id: existingPoId, items: [] });

    const result = await service.generateAutoDrafts(
      mockRestaurantId,
      '2026-07-27',
      new Types.ObjectId(),
    );

    expect(mockPurchaseOrderRepo.create).not.toHaveBeenCalled();
    expect(mockPurchaseOrderRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { _id: existingPoId } }),
    );
    expect(result.reusedExistingDrafts).toBe(1);

    // Pin the idempotency lookup itself: prove all six clauses are present,
    // not just that "once a draft is found, the right one gets updated".
    const idempotencyCall = mockPurchaseOrderRepo.findOne.mock.calls.find(
      ([{ filters }]: any) => filters?.status === PurchaseOrderStatusEnum.DRAFT,
    );
    expect(idempotencyCall).toBeDefined();
    const [{ filters: idempotencyFilters }] = idempotencyCall as any;
    expect(idempotencyFilters).toEqual(
      expect.objectContaining({
        restaurantId: mockRestaurantId,
        supplierId,
        status: PurchaseOrderStatusEnum.DRAFT,
        source: PurchaseOrderSourceEnum.AI_FORECAST,
        expectedDeliveryDate: new Date('2026-07-27T00:00:00.000Z'),
        isDeleted: false,
      }),
    );
  });

  it('does NOT overwrite a MANUALLY created draft when reusing AI drafts', async () => {
    const supplierId = new Types.ObjectId();
    const ingredientId = new Types.ObjectId();
    const existingPoId = new Types.ObjectId();

    mockPredictionRepo.findMany.mockResolvedValue([
      { productId: new Types.ObjectId(), predictedOrders: 100 },
    ]);
    mockRecipeRepo.findOne.mockResolvedValue({
      ingredients: [{ ingredientId, quantityPerPortion: 2, yieldPercentage: 100 }],
    });
    mockIngredientRepo.findOne.mockResolvedValue({
      _id: ingredientId,
      name: 'Flour',
      ingredientCode: 'FLR',
      unit: 'kg',
      supplierId,
    });
    mockInventoryBatchRepo.findMany.mockResolvedValue([]);
    mockPurchaseOrderRepo.findMany.mockResolvedValue([]);

    // Behave like the real query: only return a match when the filter is
    // actually asking for an AI_FORECAST draft. A MANUALLY sourced draft
    // (or any lookup missing that clause) must not be found/reused here.
    mockPurchaseOrderRepo.findOne.mockImplementation(({ filters }: any) =>
      Promise.resolve(
        filters?.source === PurchaseOrderSourceEnum.AI_FORECAST
          ? { _id: existingPoId, supplierId, items: [] }
          : null,
      ),
    );
    mockPurchaseOrderRepo.update.mockResolvedValue({ _id: existingPoId, items: [] });

    const result = await service.generateAutoDrafts(
      mockRestaurantId,
      '2026-07-27',
      new Types.ObjectId(),
    );

    // The AI draft is found via the source: AI_FORECAST guard and reused;
    // a manual draft (which would fail that filter) is never touched here.
    expect(mockPurchaseOrderRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { _id: existingPoId } }),
    );
    expect(mockPurchaseOrderRepo.create).not.toHaveBeenCalled();
    expect(result.reusedExistingDrafts).toBe(1);
  });
});
