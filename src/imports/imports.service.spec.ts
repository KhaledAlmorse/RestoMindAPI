import { Test, TestingModule } from '@nestjs/testing';
import { ImportsService } from './imports.service';
import { CsvParsingService } from './services/csv-parsing.service';
import { AiIngestService } from './services/ai-ingest.service';
import { ProductCostService } from 'src/Common/Services/product-cost.service';
import {
  CategoryRepository,
  ImportJobRepository,
  IngredientRepository,
  InventoryBatchRepository,
  ProductRepository,
  RecipeRepository,
  RestaurantRepository,
  SalesTransactionRepository,
  StockTransactionRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { ImportJobStatusEnum, ImportTypeEnum } from 'src/Common/Types';
import { Types } from 'mongoose';

describe('ImportsService - Dependency & Error Handling Verification', () => {
  let service: ImportsService;
  let mockImportJobRepo: any;
  let mockSalesTransactionRepo: any;
  let mockProductRepo: any;
  let mockRecipeRepo: any;
  let mockIngredientRepo: any;
  let mockInventoryBatchRepo: any;
  let mockStockTransactionRepo: any;
  let mockUserRepo: any;
  let mockRestaurantRepo: any;
  let mockAiIngestService: any;
  let mockProductCostService: any;

  let mockCategoryRepo: any;

  const mockUserId = new Types.ObjectId().toString();
  const mockRestaurantId = new Types.ObjectId();

  beforeEach(async () => {
    mockCategoryRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(), name: 'General' }),
      create: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(), name: 'General' }),
    };
    mockImportJobRepo = {
      create: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findManyPaginated: jest.fn(),
    };
    mockSalesTransactionRepo = {
      createMany: jest.fn(),
      findMany: jest.fn(),
    };
    mockProductRepo = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    mockRecipeRepo = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    mockIngredientRepo = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    mockInventoryBatchRepo = {
      create: jest.fn(),
    };
    mockStockTransactionRepo = {
      create: jest.fn(),
    };
    mockUserRepo = {
      findOne: jest.fn(),
    };
    mockRestaurantRepo = {
      findOne: jest.fn(),
    };
    mockAiIngestService = {
      ingest: jest.fn(),
    };
    mockProductCostService = {
      getUnitCost: jest.fn().mockResolvedValue(null),
      getUnitCosts: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportsService,
        CsvParsingService,
        { provide: ImportJobRepository, useValue: mockImportJobRepo },
        {
          provide: SalesTransactionRepository,
          useValue: mockSalesTransactionRepo,
        },
        { provide: ProductRepository, useValue: mockProductRepo },
        { provide: RecipeRepository, useValue: mockRecipeRepo },
        { provide: IngredientRepository, useValue: mockIngredientRepo },
        { provide: InventoryBatchRepository, useValue: mockInventoryBatchRepo },
        {
          provide: StockTransactionRepository,
          useValue: mockStockTransactionRepo,
        },
        { provide: UserRepository, useValue: mockUserRepo },
        { provide: RestaurantRepository, useValue: mockRestaurantRepo },
        { provide: CategoryRepository, useValue: mockCategoryRepo },
        { provide: AiIngestService, useValue: mockAiIngestService },
        { provide: ProductCostService, useValue: mockProductCostService },
      ],
    }).compile();

    service = module.get<ImportsService>(ImportsService);

    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(mockUserId),
      restaurantId: mockRestaurantId,
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==========================================
  // TEST CASE 1: Import sales_history before menu_items -> FAIL
  // ==========================================
  it('Test Case 1: Import sales_history before menu_items (0 products) -> FAIL', async () => {
    const jobId = new Types.ObjectId();
    const mockJob = {
      _id: jobId,
      restaurantId: mockRestaurantId,
      importType: ImportTypeEnum.SALES_HISTORY,
      rawRows: [['2026-07-01', 'Croissant', '10', '12', '18']],
      columnMapping: {
        Date: 'date',
        Product: 'productId',
        Quantity: 'quantitySold',
        Production: 'productionQuantity',
        Price: 'sellingPrice',
      },
      status: ImportJobStatusEnum.PROCESSING,
    };

    mockImportJobRepo.findOne.mockResolvedValue(mockJob);
    mockProductRepo.findMany.mockResolvedValue([]); // 0 products!
    mockImportJobRepo.findOneAndUpdate.mockImplementation(
      ({ updateData }: any) => Promise.resolve({ _id: jobId, ...updateData }),
    );

    const result = await service.confirmImport(
      jobId.toString(),
      {},
      mockUserId,
    );

    expect(result.data.status).toBe(ImportJobStatusEnum.FAILED);
    expect(result.data.importedCount).toBe(0);
    expect(result.data.errors?.[0]?.message).toContain(
      'Cannot import sales history before onboarding menu items',
    );
    expect(mockSalesTransactionRepo.createMany).not.toHaveBeenCalled();
    expect(mockAiIngestService.ingest).not.toHaveBeenCalled();
  });

  // ==========================================
  // TEST CASE 2: Import recipes before menu_items -> FAIL
  // ==========================================
  it('Test Case 2: Import recipes before menu_items (0 products) -> FAIL', async () => {
    const jobId = new Types.ObjectId();
    const mockJob = {
      _id: jobId,
      restaurantId: mockRestaurantId,
      importType: ImportTypeEnum.RECIPES,
      rawRows: [['Croissant', 'Flour', '0.2']],
      columnMapping: {
        Product: 'productId',
        Ingredient: 'ingredientId',
        Qty: 'quantityPerPortion',
      },
      status: ImportJobStatusEnum.PROCESSING,
    };

    mockImportJobRepo.findOne.mockResolvedValue(mockJob);
    mockProductRepo.findMany.mockResolvedValue([]); // 0 products!
    mockIngredientRepo.findMany.mockResolvedValue([
      { _id: new Types.ObjectId(), name: 'Flour' },
    ]);
    mockImportJobRepo.findOneAndUpdate.mockImplementation(
      ({ updateData }: any) => Promise.resolve({ _id: jobId, ...updateData }),
    );

    const result = await service.confirmImport(
      jobId.toString(),
      {},
      mockUserId,
    );

    expect(result.data.status).toBe(ImportJobStatusEnum.FAILED);
    expect(result.data.importedCount).toBe(0);
    expect(result.data.errors?.[0]?.message).toContain(
      'Cannot import recipes before onboarding menu items',
    );
    expect(mockRecipeRepo.create).not.toHaveBeenCalled();
  });

  // ==========================================
  // TEST CASE 3: Import recipes before ingredients -> FAIL
  // ==========================================
  it('Test Case 3: Import recipes before ingredients (0 ingredients) -> FAIL', async () => {
    const jobId = new Types.ObjectId();
    const mockJob = {
      _id: jobId,
      restaurantId: mockRestaurantId,
      importType: ImportTypeEnum.RECIPES,
      rawRows: [['Croissant', 'Flour', '0.2']],
      columnMapping: {
        Product: 'productId',
        Ingredient: 'ingredientId',
        Qty: 'quantityPerPortion',
      },
      status: ImportJobStatusEnum.PROCESSING,
    };

    mockImportJobRepo.findOne.mockResolvedValue(mockJob);
    mockProductRepo.findMany.mockResolvedValue([
      { _id: new Types.ObjectId(), title: 'Croissant' },
    ]);
    mockIngredientRepo.findMany.mockResolvedValue([]); // 0 ingredients!
    mockImportJobRepo.findOneAndUpdate.mockImplementation(
      ({ updateData }: any) => Promise.resolve({ _id: jobId, ...updateData }),
    );

    const result = await service.confirmImport(
      jobId.toString(),
      {},
      mockUserId,
    );

    expect(result.data.status).toBe(ImportJobStatusEnum.FAILED);
    expect(result.data.importedCount).toBe(0);
    expect(result.data.errors?.[0]?.message).toContain(
      'Cannot import recipes before onboarding ingredients',
    );
    expect(mockRecipeRepo.create).not.toHaveBeenCalled();
  });

  // ==========================================
  // TEST CASE 4: Import inventory before ingredients -> FAIL
  // ==========================================
  it('Test Case 4: Import inventory_transactions before ingredients (0 ingredients) -> FAIL', async () => {
    const jobId = new Types.ObjectId();
    const mockJob = {
      _id: jobId,
      restaurantId: mockRestaurantId,
      importType: ImportTypeEnum.INVENTORY_TRANSACTIONS,
      rawRows: [['Flour', '50', 'BATCH-100']],
      columnMapping: {
        Ingredient: 'ingredientId',
        Quantity: 'quantity',
        Batch: 'batchNumber',
      },
      status: ImportJobStatusEnum.PROCESSING,
    };

    mockImportJobRepo.findOne.mockResolvedValue(mockJob);
    mockIngredientRepo.findMany.mockResolvedValue([]); // 0 ingredients!
    mockImportJobRepo.findOneAndUpdate.mockImplementation(
      ({ updateData }: any) => Promise.resolve({ _id: jobId, ...updateData }),
    );

    const result = await service.confirmImport(
      jobId.toString(),
      {},
      mockUserId,
    );

    expect(result.data.status).toBe(ImportJobStatusEnum.FAILED);
    expect(result.data.importedCount).toBe(0);
    expect(result.data.errors?.[0]?.message).toContain(
      'Cannot import inventory transactions before onboarding ingredients',
    );
    expect(mockInventoryBatchRepo.create).not.toHaveBeenCalled();
  });

  // ==========================================
  // TEST CASE 5: Full valid sequence -> SUCCESS
  // ==========================================
  it('Test Case 5: Full valid sequence (menu_items -> ingredients -> recipes -> inventory -> sales_history) -> SUCCESS', async () => {
    const productId = new Types.ObjectId();
    const ingredientId = new Types.ObjectId();

    // Step 1: menu_items
    const job1Id = new Types.ObjectId();
    mockImportJobRepo.findOne.mockResolvedValueOnce({
      _id: job1Id,
      restaurantId: mockRestaurantId,
      importType: ImportTypeEnum.MENU_ITEMS,
      rawRows: [['Croissant', '18']],
      columnMapping: { Title: 'title', Price: 'price' },
      status: ImportJobStatusEnum.PROCESSING,
    });
    mockProductRepo.findOne.mockResolvedValueOnce(null);
    mockProductRepo.create.mockResolvedValueOnce({
      _id: productId,
      title: 'Croissant',
      price: 18,
    });
    mockImportJobRepo.findOneAndUpdate.mockImplementationOnce(
      ({ updateData }: any) => Promise.resolve({ _id: job1Id, ...updateData }),
    );

    const res1 = await service.confirmImport(job1Id.toString(), {}, mockUserId);
    expect(res1.data.status).toBe(ImportJobStatusEnum.COMPLETED);
    expect(res1.data.importedCount).toBe(1);

    // Step 2: ingredients
    const job2Id = new Types.ObjectId();
    mockImportJobRepo.findOne.mockResolvedValueOnce({
      _id: job2Id,
      restaurantId: mockRestaurantId,
      importType: ImportTypeEnum.INGREDIENTS,
      rawRows: [['Flour', 'FLOUR-01', 'kg', '30']],
      columnMapping: {
        Name: 'name',
        Code: 'ingredientCode',
        Unit: 'unit',
        'Shelf Life': 'shelfLifeDays',
      },
      status: ImportJobStatusEnum.PROCESSING,
    });
    mockIngredientRepo.findOne.mockResolvedValueOnce(null);
    mockIngredientRepo.create.mockResolvedValueOnce({
      _id: ingredientId,
      name: 'Flour',
      ingredientCode: 'FLOUR-01',
    });
    mockImportJobRepo.findOneAndUpdate.mockImplementationOnce(
      ({ updateData }: any) => Promise.resolve({ _id: job2Id, ...updateData }),
    );

    const res2 = await service.confirmImport(job2Id.toString(), {}, mockUserId);
    expect(res2.data.status).toBe(ImportJobStatusEnum.COMPLETED);
    expect(res2.data.importedCount).toBe(1);

    // Step 3: recipes (now products and ingredients exist)
    const job3Id = new Types.ObjectId();
    mockImportJobRepo.findOne.mockResolvedValueOnce({
      _id: job3Id,
      restaurantId: mockRestaurantId,
      importType: ImportTypeEnum.RECIPES,
      rawRows: [['Croissant', 'Flour', '0.2']],
      columnMapping: {
        Product: 'productId',
        Ingredient: 'ingredientId',
        Qty: 'quantityPerPortion',
      },
      status: ImportJobStatusEnum.PROCESSING,
    });
    mockProductRepo.findMany.mockResolvedValueOnce([
      { _id: productId, title: 'Croissant' },
    ]);
    mockIngredientRepo.findMany.mockResolvedValueOnce([
      { _id: ingredientId, name: 'Flour', ingredientCode: 'FLOUR-01' },
    ]);
    mockRecipeRepo.findOne.mockResolvedValueOnce(null);
    mockRecipeRepo.create.mockResolvedValueOnce({ _id: new Types.ObjectId() });
    mockImportJobRepo.findOneAndUpdate.mockImplementationOnce(
      ({ updateData }: any) => Promise.resolve({ _id: job3Id, ...updateData }),
    );

    const res3 = await service.confirmImport(job3Id.toString(), {}, mockUserId);
    expect(res3.data.status).toBe(ImportJobStatusEnum.COMPLETED);
    expect(res3.data.importedCount).toBe(1);

    // Step 4: inventory_transactions (now ingredients exist)
    const job4Id = new Types.ObjectId();
    mockImportJobRepo.findOne.mockResolvedValueOnce({
      _id: job4Id,
      restaurantId: mockRestaurantId,
      importType: ImportTypeEnum.INVENTORY_TRANSACTIONS,
      rawRows: [['Flour', '50', 'BATCH-100']],
      columnMapping: {
        Ingredient: 'ingredientId',
        Quantity: 'quantity',
        Batch: 'batchNumber',
      },
      status: ImportJobStatusEnum.PROCESSING,
    });
    mockIngredientRepo.findMany.mockResolvedValueOnce([
      { _id: ingredientId, name: 'Flour', ingredientCode: 'FLOUR-01' },
    ]);
    mockInventoryBatchRepo.create.mockResolvedValueOnce({
      _id: new Types.ObjectId(),
    });
    mockStockTransactionRepo.create.mockResolvedValueOnce({
      _id: new Types.ObjectId(),
    });
    mockImportJobRepo.findOneAndUpdate.mockImplementationOnce(
      ({ updateData }: any) => Promise.resolve({ _id: job4Id, ...updateData }),
    );

    const res4 = await service.confirmImport(job4Id.toString(), {}, mockUserId);
    expect(res4.data.status).toBe(ImportJobStatusEnum.COMPLETED);
    expect(res4.data.importedCount).toBe(1);

    // Step 5: sales_history (now products exist -> triggers AI Ingest)
    const job5Id = new Types.ObjectId();
    mockImportJobRepo.findOne.mockResolvedValueOnce({
      _id: job5Id,
      restaurantId: mockRestaurantId,
      importType: ImportTypeEnum.SALES_HISTORY,
      rawRows: [['2026-07-01', 'Croissant', '10', '12', '18']],
      columnMapping: {
        Date: 'date',
        Product: 'productId',
        Quantity: 'quantitySold',
        Production: 'productionQuantity',
        Price: 'sellingPrice',
      },
      status: ImportJobStatusEnum.PROCESSING,
    });
    mockProductRepo.findMany.mockResolvedValueOnce([
      { _id: productId, title: 'Croissant', price: 18 },
    ]);
    mockSalesTransactionRepo.createMany.mockResolvedValueOnce([
      { _id: new Types.ObjectId() },
    ]);
    mockAiIngestService.ingest.mockResolvedValueOnce({
      success: true,
      attempts: 1,
    });
    mockImportJobRepo.findOneAndUpdate.mockImplementationOnce(
      ({ updateData }: any) => Promise.resolve({ _id: job5Id, ...updateData }),
    );

    const res5 = await service.confirmImport(job5Id.toString(), {}, mockUserId);
    expect(res5.data.status).toBe(ImportJobStatusEnum.COMPLETED);
    expect(res5.data.importedCount).toBe(1);
    expect(mockAiIngestService.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        records: [
          expect.objectContaining({
            salesQty: 10,
            productionQty: 12,
          }),
        ],
      }),
    );
  });

  describe('Import Failure Reason & Error Handling Verification', () => {
    beforeEach(() => {
      mockUserRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(mockUserId),
        restaurantId: mockRestaurantId,
      });
    });

    it('TEST 1: Dependency guard failure stores failureReason', async () => {
      const jobId = new Types.ObjectId();
      mockImportJobRepo.findOne.mockResolvedValueOnce({
        _id: jobId,
        restaurantId: mockRestaurantId,
        importType: ImportTypeEnum.RECIPES,
        rawRows: [['ProductA', 'IngA', '1']],
        status: ImportJobStatusEnum.PROCESSING,
      });
      mockProductRepo.findMany.mockResolvedValueOnce([]); // No products exist

      mockImportJobRepo.findOneAndUpdate.mockImplementationOnce(
        ({ updateData }: any) => Promise.resolve({ _id: jobId, ...updateData }),
      );

      const res = await service.confirmImport(jobId.toString(), {}, mockUserId);
      expect(res.data.status).toBe(ImportJobStatusEnum.FAILED);
      expect(res.data.failureReason).toBe(
        'Cannot import recipes before onboarding menu items. Please import menu_items first.',
      );
    });

    it('TEST 2: All-rows validation failure stores failureReason', async () => {
      const jobId = new Types.ObjectId();
      mockImportJobRepo.findOne.mockResolvedValueOnce({
        _id: jobId,
        restaurantId: mockRestaurantId,
        importType: ImportTypeEnum.MENU_ITEMS,
        rawRows: [['', 'invalid-price']], // Missing title and invalid price
        columnMapping: { Title: 'title', Price: 'price' },
        status: ImportJobStatusEnum.PROCESSING,
      });

      mockImportJobRepo.findOneAndUpdate.mockImplementationOnce(
        ({ updateData }: any) => Promise.resolve({ _id: jobId, ...updateData }),
      );

      const res = await service.confirmImport(jobId.toString(), {}, mockUserId);
      expect(res.data.status).toBe(ImportJobStatusEnum.FAILED);
      expect(res.data.failureReason).toBe(
        'Import failed: All rows contain validation errors. Check the errors list for details.',
      );
    });

    it('TEST 3: AI ingest failure stores a safe failureReason while preserving AI_INGEST_FAILED and aiIngestLastError', async () => {
      const jobId = new Types.ObjectId();
      const productId = new Types.ObjectId();
      mockImportJobRepo.findOne.mockResolvedValueOnce({
        _id: jobId,
        restaurantId: mockRestaurantId,
        importType: ImportTypeEnum.SALES_HISTORY,
        rawRows: [['2026-07-01', 'Burger', '5', '8', '10']],
        columnMapping: {
          Date: 'date',
          Product: 'productId',
          Qty: 'quantitySold',
          Production: 'productionQuantity',
          Price: 'sellingPrice',
        },
        status: ImportJobStatusEnum.PROCESSING,
      });
      mockProductRepo.findMany.mockResolvedValueOnce([
        { _id: productId, title: 'Burger', price: 10 },
      ]);
      mockSalesTransactionRepo.createMany.mockResolvedValueOnce([
        { _id: new Types.ObjectId() },
      ]);
      mockAiIngestService.ingest.mockResolvedValueOnce({
        success: false,
        attempts: 3,
        error: 'Connection refused to AI Gateway',
      });

      mockImportJobRepo.findOneAndUpdate.mockImplementationOnce(
        ({ updateData }: any) => Promise.resolve({ _id: jobId, ...updateData }),
      );

      const res = await service.confirmImport(jobId.toString(), {}, mockUserId);
      expect(res.data.status).toBe(ImportJobStatusEnum.AI_INGEST_FAILED);
      expect(res.data.aiIngestLastError).toBe(
        'Connection refused to AI Gateway',
      );
      expect(res.data.failureReason).toBe(
        'Sales history imported successfully, but AI model synchronization failed. Please try again later.',
      );
    });

    it('TEST 4: Unexpected runtime exception changes status to FAILED and stores sanitized failureReason without exposing raw stack trace', async () => {
      const jobId = new Types.ObjectId();
      mockImportJobRepo.findOne.mockResolvedValueOnce({
        _id: jobId,
        restaurantId: mockRestaurantId,
        importType: ImportTypeEnum.MENU_ITEMS,
        rawRows: [['Burger', '15']],
        columnMapping: { Title: 'title', Price: 'price' },
        status: ImportJobStatusEnum.PROCESSING,
      });

      // Simulate unexpected DB explosion during processing
      mockProductRepo.findOne.mockRejectedValueOnce(
        new Error(
          'MongoError: E11000 duplicate key error collection: restomind.products',
        ),
      );

      mockImportJobRepo.findOneAndUpdate.mockImplementationOnce(
        ({ updateData }: any) => Promise.resolve({ _id: jobId, ...updateData }),
      );

      await expect(
        service.confirmImport(jobId.toString(), {}, mockUserId),
      ).rejects.toThrow(
        'Import processing failed due to an unexpected system error. Please try again.',
      );

      expect(mockImportJobRepo.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          updateData: expect.objectContaining({
            status: ImportJobStatusEnum.FAILED,
            failureReason:
              'Import processing failed due to an unexpected system error. Please try again.',
          }),
        }),
      );
    });

    it('TEST 5: Successful Import does not contain failureReason', async () => {
      const jobId = new Types.ObjectId();
      mockImportJobRepo.findOne.mockResolvedValueOnce({
        _id: jobId,
        restaurantId: mockRestaurantId,
        importType: ImportTypeEnum.MENU_ITEMS,
        rawRows: [['Burger', '15']],
        columnMapping: { Title: 'title', Price: 'price' },
        status: ImportJobStatusEnum.PROCESSING,
      });
      mockProductRepo.findOne.mockResolvedValueOnce(null);
      mockCategoryRepo.findOne.mockResolvedValueOnce({
        _id: new Types.ObjectId(),
      });
      mockProductRepo.create.mockResolvedValueOnce({
        _id: new Types.ObjectId(),
      });

      mockImportJobRepo.findOneAndUpdate.mockImplementationOnce(
        ({ updateData }: any) => Promise.resolve({ _id: jobId, ...updateData }),
      );

      const res = await service.confirmImport(jobId.toString(), {}, mockUserId);
      expect(res.data.status).toBe(ImportJobStatusEnum.COMPLETED);
      expect(res.data.failureReason).toBeUndefined();
    });

    it('TEST 6: GET /imports returns failureReason for failed imports', async () => {
      const failedJob = {
        _id: new Types.ObjectId(),
        status: ImportJobStatusEnum.FAILED,
        failureReason:
          'Import failed: All rows contain validation errors. Check the errors list for details.',
      };
      mockImportJobRepo.findManyPaginated.mockResolvedValueOnce({
        items: [failedJob],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });

      const res = await service.getImportJobs({}, mockUserId);
      expect(res.items[0]).toHaveProperty('failureReason');
      expect(res.items[0].failureReason).toBe(
        'Import failed: All rows contain validation errors. Check the errors list for details.',
      );
    });

    it('TEST 7: GET /imports/:id returns failureReason for failed imports', async () => {
      const jobId = new Types.ObjectId();
      const failedJob = {
        _id: jobId,
        status: ImportJobStatusEnum.FAILED,
        failureReason:
          'Cannot import recipes before onboarding menu items. Please import menu_items first.',
      };
      mockImportJobRepo.findOne.mockResolvedValueOnce(failedJob);

      const res = await service.getImportJobById(jobId.toString(), mockUserId);
      expect(res.data).toHaveProperty('failureReason');
      expect(res.data.failureReason).toBe(
        'Cannot import recipes before onboarding menu items. Please import menu_items first.',
      );
    });

    it('TEST 8: Existing Import behavior remains unchanged for successful imports and paginated responses', async () => {
      const jobId = new Types.ObjectId();
      const successJob = {
        _id: jobId,
        status: ImportJobStatusEnum.COMPLETED,
        totalRows: 5,
        validRows: 5,
      };
      mockImportJobRepo.findOne.mockResolvedValueOnce(successJob);

      const res = await service.getImportJobById(jobId.toString(), mockUserId);
      expect(res.data.status).toBe(ImportJobStatusEnum.COMPLETED);
      expect(res.data.failureReason).toBeUndefined();
    });
  });
});
