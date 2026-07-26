import { Test, TestingModule } from '@nestjs/testing';
import { ImportsService } from './imports.service';
import { CsvParsingService } from './services/csv-parsing.service';
import { AiIngestService } from './services/ai-ingest.service';
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
      rawRows: [['2026-07-01', 'Croissant', '10', '18']],
      columnMapping: {
        Date: 'date',
        Product: 'productId',
        Quantity: 'quantitySold',
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
      rawRows: [['2026-07-01', 'Croissant', '10', '18']],
      columnMapping: {
        Date: 'date',
        Product: 'productId',
        Quantity: 'quantitySold',
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
    expect(mockAiIngestService.ingest).toHaveBeenCalled(); // AI Ingest cleanly triggered!
  });
});
