import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import {
  OfferSourceEnum,
  OfferStatusEnum,
  RecommendationStatusEnum,
  RecommendationTypeEnum,
  RiskLevelEnum,
} from 'src/Common/Types';
import {
  CategoryRepository,
  IngredientRepository,
  InventoryBatchRepository,
  OfferRepository,
  PredictionRepository,
  ProductRepository,
  RecipeRepository,
  RecommendationRepository,
  RestaurantRepository,
  SalesTransactionRepository,
  UserRepository,
  WasteReportRepository,
} from 'src/DB/Repositories';
import { RecommendationsService } from './recommendations.service';
import { AiClientService } from 'src/Common/Services/ai-client.service';

describe('RecommendationsService', () => {
  let service: RecommendationsService;

  let mockRecommendationRepo: any;
  let mockWasteReportRepo: any;
  let mockProductRepo: any;
  let mockOfferRepo: any;
  let mockRestaurantRepo: any;
  let mockUserRepo: any;
  let mockCategoryRepo: any;
  let mockSalesRepo: any;
  let mockInventoryBatchRepo: any;
  let mockIngredientRepo: any;
  let mockRecipeRepo: any;
  let mockPredictionRepo: any;

  const mockUserId = new Types.ObjectId().toString();
  const mockRestaurantId = new Types.ObjectId();
  const mockProductId = new Types.ObjectId();
  const mockIngredientId = new Types.ObjectId();
  const mockRecId = new Types.ObjectId();

  const mockUser = {
    _id: new Types.ObjectId(mockUserId),
    restaurantId: mockRestaurantId,
  };

  const mockProduct = {
    _id: mockProductId,
    restaurantId: mockRestaurantId,
    title: 'Kanafeh',
    price: 100,
    freshnessWindow: 2,
    isDeleted: false,
  };

  const mockRecipe = {
    _id: new Types.ObjectId(),
    restaurantId: mockRestaurantId,
    productId: mockProductId,
    ingredients: [
      {
        ingredientId: mockIngredientId,
        quantityPerPortion: 0.2,
        unit: 'kg',
        yieldPercentage: 100,
      },
    ],
    isDeleted: false,
  };

  const mockRecommendation = {
    _id: mockRecId,
    restaurantId: mockRestaurantId,
    productId: mockProductId,
    type: RecommendationTypeEnum.APPLY_DISCOUNT,
    suggestedValue: 20,
    gptExplanation: '20% discount for surplus Kanafeh',
    status: RecommendationStatusEnum.PENDING,
    isDeleted: false,
  };

  beforeEach(async () => {
    mockRecommendationRepo = {
      findManyPaginated: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    mockWasteReportRepo = {
      findManyPaginated: jest.fn(),
      findMany: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    };

    mockProductRepo = {
      findMany: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    mockOfferRepo = {
      findMany: jest.fn(),
      create: jest.fn(),
    };

    mockRestaurantRepo = {
      findOne: jest.fn(),
    };

    mockUserRepo = {
      findOne: jest.fn().mockResolvedValue(mockUser),
    };

    mockCategoryRepo = {
      findMany: jest.fn(),
    };

    mockSalesRepo = {
      findMany: jest.fn(),
    };

    mockInventoryBatchRepo = {
      findMany: jest.fn().mockResolvedValue([]),
    };

    mockIngredientRepo = {
      findOne: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      create: jest.fn(),
    };

    mockRecipeRepo = {
      findOne: jest.fn().mockResolvedValue(mockRecipe),
    };

    mockPredictionRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecommendationsService,
        AiClientService,
        { provide: RecommendationRepository, useValue: mockRecommendationRepo },
        { provide: WasteReportRepository, useValue: mockWasteReportRepo },
        { provide: ProductRepository, useValue: mockProductRepo },
        { provide: OfferRepository, useValue: mockOfferRepo },
        { provide: RestaurantRepository, useValue: mockRestaurantRepo },
        { provide: UserRepository, useValue: mockUserRepo },
        { provide: CategoryRepository, useValue: mockCategoryRepo },
        { provide: SalesTransactionRepository, useValue: mockSalesRepo },
        { provide: InventoryBatchRepository, useValue: mockInventoryBatchRepo },
        { provide: IngredientRepository, useValue: mockIngredientRepo },
        { provide: RecipeRepository, useValue: mockRecipeRepo },
        { provide: PredictionRepository, useValue: mockPredictionRepo },
      ],
    }).compile();

    service = module.get<RecommendationsService>(RecommendationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('approveRecommendation', () => {
    it('should create an Offer, update recommendation to approved, and NEVER modify Product or add discountedPrice', async () => {
      mockRecommendationRepo.findOne.mockResolvedValue(mockRecommendation);
      mockProductRepo.findOne.mockResolvedValue(mockProduct);
      mockOfferRepo.findMany.mockResolvedValue([]); // No overlapping active offers
      mockOfferRepo.create.mockImplementation((doc: any) =>
        Promise.resolve({ ...doc, _id: new Types.ObjectId() }),
      );
      mockRecommendationRepo.update.mockResolvedValue({
        ...mockRecommendation,
        status: RecommendationStatusEnum.APPROVED,
      });

      const result = await service.approveRecommendation(
        mockRecId.toString(),
        mockUserId,
        { availableQuantity: 15 },
      );

      // 1. Assert Offer was created with correct pricing model
      expect(mockOfferRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: mockProductId,
          originalPrice: 100,
          offerPrice: 80, // 100 * (1 - 20/100)
          discountPercentage: 20,
          availableQuantity: 15,
          source: OfferSourceEnum.AI_RECOMMENDATION,
          status: OfferStatusEnum.ACTIVE,
        }),
      );

      // 2. Assert Recommendation status was updated to approved
      expect(mockRecommendationRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            status: RecommendationStatusEnum.APPROVED,
          }),
        }),
      );

      // 3. EXPLICIT REGRESSION TEST: Product repository update was NEVER called
      expect(mockProductRepo.update).not.toHaveBeenCalled();
      expect(mockProduct).not.toHaveProperty('discountedPrice');

      expect(result.message).toContain('approved');
    });

    it('should throw ConflictException if an active or scheduled offer already exists for the product', async () => {
      mockRecommendationRepo.findOne.mockResolvedValue(mockRecommendation);
      mockProductRepo.findOne.mockResolvedValue(mockProduct);
      // Simulate existing active offer
      mockOfferRepo.findMany.mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          productId: mockProductId,
          status: OfferStatusEnum.ACTIVE,
        },
      ]);

      await expect(
        service.approveRecommendation(mockRecId.toString(), mockUserId, {}),
      ).rejects.toThrow(ConflictException);

      expect(mockOfferRepo.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if recommendation is already approved', async () => {
      mockRecommendationRepo.findOne.mockResolvedValue({
        ...mockRecommendation,
        status: RecommendationStatusEnum.APPROVED,
      });

      await expect(
        service.approveRecommendation(mockRecId.toString(), mockUserId, {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('scanSurplus & validatePlan graceful AI failure', () => {
    it('should return early message when no products with recipes exist', async () => {
      mockProductRepo.findMany.mockResolvedValue([mockProduct]);
      mockRecipeRepo.findOne.mockResolvedValue(null);

      const result = await service.scanSurplus(mockUserId);

      expect(result.data).toHaveProperty(
        'message',
        'No products with recipes found for surplus scan',
      );
      expect(result.data).toHaveProperty('scannedCount', 0);
      expect(result.degraded).toBe(false);
    });

    it('should return a degraded response (not throw) when surplus scan AI service is unreachable', async () => {
      mockProductRepo.findMany.mockResolvedValue([mockProduct]);
      mockRecipeRepo.findOne.mockResolvedValue(mockRecipe);
      mockPredictionRepo.findOne.mockResolvedValue(null);
      mockInventoryBatchRepo.findMany.mockResolvedValue([]);

      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const result = await service.scanSurplus(mockUserId);

      expect(result.degraded).toBe(true);
      expect(result.degradedReason).toContain('Network error');
    });

    it('should send closeHour as integer 22 to AI service during scanSurplus', async () => {
      mockProductRepo.findMany.mockResolvedValue([mockProduct]);
      mockRecipeRepo.findOne.mockResolvedValue(mockRecipe);
      mockPredictionRepo.findOne.mockResolvedValue(null);
      mockInventoryBatchRepo.findMany.mockResolvedValue([]);
      mockWasteReportRepo.findOne.mockResolvedValue(null);
      mockWasteReportRepo.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        restaurantId: mockRestaurantId,
        riskLevel: RiskLevelEnum.LOW,
      });
      mockRecommendationRepo.findOne.mockResolvedValue(null);
      mockRecommendationRepo.create.mockResolvedValue(mockRecommendation);

      const mockFetchResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          itemsAtRisk: [
            {
              productId: mockProductId.toString(),
              suggestedDiscountPct: 20,
              offerCopyAr: 'خصم على الكرواسون',
            },
          ],
        }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse as any);

      await service.scanSurplus(mockUserId);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/integration/restomind/surplus-offers'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringMatching(/"closeHour":22/),
        }),
      );

      const fetchCallBody = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body,
      );
      expect(fetchCallBody.closeHour).toBe(22);
      expect(typeof fetchCallBody.closeHour).toBe('number');
    });

    it('should create a WasteReport with locally calculated values and pass wasteReportId to Recommendation', async () => {
      const mockWasteReportId = new Types.ObjectId();

      mockProductRepo.findMany.mockResolvedValue([mockProduct]);
      mockRecipeRepo.findOne.mockResolvedValue(mockRecipe);

      // Prediction: 100 predicted orders
      mockPredictionRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        predictedOrders: 100,
        dailyBreakdown: [],
      });

      // Inventory: batches with total 120 kg
      mockInventoryBatchRepo.findMany.mockResolvedValue([
        { quantityRemaining: 50 },
        { quantityRemaining: 70 },
      ]);

      mockWasteReportRepo.findOne.mockResolvedValue(null);
      mockWasteReportRepo.create.mockResolvedValue({
        _id: mockWasteReportId,
        restaurantId: mockRestaurantId,
        riskLevel: RiskLevelEnum.MEDIUM,
      });

      mockRecommendationRepo.findOne.mockResolvedValue(null);
      mockRecommendationRepo.create.mockImplementation((doc: any) =>
        Promise.resolve({ ...doc, _id: new Types.ObjectId() }),
      );

      const mockFetchResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          itemsAtRisk: [
            {
              productId: mockProductId.toString(),
              suggestedDiscountPct: 30,
              offerCopyAr: 'عرض خاص على الكنافة',
            },
          ],
        }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse as any);

      await service.scanSurplus(mockUserId);

      // Expected local calculations:
      // usableAvailableStock = 50 + 70 = 120
      // expectedConsumption = 100 * 0.2 = 20
      // expectedSurplus = 120 - 20 = 100
      // surplusRatio = 100 / 120 = 0.833 -> riskLevel = HIGH (>= 0.7)

      expect(mockWasteReportRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId: mockRestaurantId,
          usableAvailableStock: 120,
          expectedConsumption: 20,
          expectedSurplus: 100,
          riskLevel: RiskLevelEnum.HIGH,
        }),
      );

      expect(mockRecommendationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId: mockRestaurantId,
          productId: mockProductId,
          wasteReportId: mockWasteReportId,
          suggestedValue: 30,
        }),
      );
    });

    it('should update existing WasteReport instead of creating duplicate on second scan same day', async () => {
      const existingWasteReportId = new Types.ObjectId();

      mockProductRepo.findMany.mockResolvedValue([mockProduct]);
      mockRecipeRepo.findOne.mockResolvedValue(mockRecipe);
      mockPredictionRepo.findOne.mockResolvedValue(null);
      mockInventoryBatchRepo.findMany.mockResolvedValue([
        { quantityRemaining: 100 },
      ]);

      // Simulate existing WasteReport found
      mockWasteReportRepo.findOne.mockResolvedValue({
        _id: existingWasteReportId,
        restaurantId: mockRestaurantId,
      });
      mockWasteReportRepo.update.mockResolvedValue({
        _id: existingWasteReportId,
        restaurantId: mockRestaurantId,
      });

      mockRecommendationRepo.findOne.mockResolvedValue(mockRecommendation);
      mockRecommendationRepo.update.mockResolvedValue(mockRecommendation);

      const mockFetchResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          itemsAtRisk: [
            {
              productId: mockProductId.toString(),
              suggestedDiscountPct: 25,
            },
          ],
        }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse as any);

      await service.scanSurplus(mockUserId);

      expect(mockWasteReportRepo.create).not.toHaveBeenCalled();
      expect(mockWasteReportRepo.update).toHaveBeenCalled();
      expect(mockRecommendationRepo.create).not.toHaveBeenCalled();
      expect(mockRecommendationRepo.update).toHaveBeenCalled();
    });

    it('should handle multi-ingredient recipes by creating separate WasteReport per ingredient', async () => {
      const ingredientId2 = new Types.ObjectId();

      const multiIngredientRecipe = {
        _id: new Types.ObjectId(),
        restaurantId: mockRestaurantId,
        productId: mockProductId,
        ingredients: [
          {
            ingredientId: mockIngredientId,
            quantityPerPortion: 0.3,
            unit: 'kg',
            yieldPercentage: 100,
          },
          {
            ingredientId: ingredientId2,
            quantityPerPortion: 0.1,
            unit: 'kg',
            yieldPercentage: 100,
          },
        ],
        isDeleted: false,
      };

      mockProductRepo.findMany.mockResolvedValue([mockProduct]);
      mockRecipeRepo.findOne.mockResolvedValue(multiIngredientRecipe);
      mockPredictionRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        predictedOrders: 50,
        dailyBreakdown: [],
      });
      mockInventoryBatchRepo.findMany.mockResolvedValue([
        { quantityRemaining: 30 },
      ]);

      mockWasteReportRepo.findOne.mockResolvedValue(null);
      mockWasteReportRepo.create.mockResolvedValue({
        _id: new Types.ObjectId(),
      });

      mockRecommendationRepo.findOne.mockResolvedValue(null);
      mockRecommendationRepo.create.mockResolvedValue(mockRecommendation);

      const mockFetchResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          itemsAtRisk: [
            {
              productId: mockProductId.toString(),
              suggestedDiscountPct: 20,
            },
          ],
        }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse as any);

      await service.scanSurplus(mockUserId);

      // Should create one WasteReport per ingredient
      expect(mockWasteReportRepo.create).toHaveBeenCalledTimes(2);
    });

    it('should calculate avgDailySales from prediction dailyBreakdown', async () => {
      mockProductRepo.findMany.mockResolvedValue([mockProduct]);
      mockRecipeRepo.findOne.mockResolvedValue(mockRecipe);

      // Prediction with daily breakdown averaging to ~14/day
      mockPredictionRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        predictedOrders: 100,
        dailyBreakdown: [
          { date: '2026-07-20', predictedQuantity: 10 },
          { date: '2026-07-21', predictedQuantity: 15 },
          { date: '2026-07-22', predictedQuantity: 20 },
          { date: '2026-07-23', predictedQuantity: 10 },
          { date: '2026-07-24', predictedQuantity: 15 },
          { date: '2026-07-25', predictedQuantity: 20 },
          { date: '2026-07-26', predictedQuantity: 10 },
        ],
      });

      mockInventoryBatchRepo.findMany.mockResolvedValue([]);
      mockWasteReportRepo.findOne.mockResolvedValue(null);
      mockWasteReportRepo.create.mockResolvedValue({
        _id: new Types.ObjectId(),
      });
      mockRecommendationRepo.findOne.mockResolvedValue(null);
      mockRecommendationRepo.create.mockResolvedValue(mockRecommendation);

      const mockFetchResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          itemsAtRisk: [],
        }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse as any);

      await service.scanSurplus(mockUserId);

      const fetchCallBody = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body,
      );
      // avgDailySales = round((10+15+20+10+15+20+10) / 7) = round(100/7) = 14
      expect(fetchCallBody.stock[0].avgDailySales).toBe(14);
    });

    it('should throw ServiceUnavailableException when validatePlan AI service is unreachable', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      await expect(
        service.validatePlan(mockUserId, {
          sku: 'SKU123',
          planned_quantity: 50,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('returns a degraded response instead of throwing when the AI is down', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        restaurantId: mockRestaurantId,
      });
      mockProductRepo.findMany.mockResolvedValue([
        { _id: mockProductId, title: 'Baklava', price: 50, freshnessWindow: 2 },
      ]);
      mockRecipeRepo.findOne.mockResolvedValue({
        ingredients: [
          { ingredientId: new Types.ObjectId(), quantityPerPortion: 2 },
        ],
      });
      mockPredictionRepo.findOne.mockResolvedValue({ predictedOrders: 100 });
      mockInventoryBatchRepo.findMany.mockResolvedValue([{ quantityRemaining: 500 }]);
      mockWasteReportRepo.findOne.mockResolvedValue(null);
      mockWasteReportRepo.create.mockResolvedValue({ _id: new Types.ObjectId() });

      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

      const result = await service.scanSurplus('507f1f77bcf86cd799439011');

      expect(result.degraded).toBe(true);
      expect(result.degradedReason).toContain('ECONNREFUSED');
      // The waste reports it already wrote must still be reported, not discarded.
      expect(mockWasteReportRepo.create).toHaveBeenCalled();
    });

    it('scopes the prediction lookup to a targetWeek and sends the real category', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        restaurantId: mockRestaurantId,
      });
      mockProductRepo.findMany.mockResolvedValue([
        {
          _id: mockProductId,
          title: 'Croissant',
          price: 18,
          freshnessWindow: 2,
          category: { name: 'معجنات' },
        },
      ]);
      mockRecipeRepo.findOne.mockResolvedValue({
        ingredients: [{ ingredientId: new Types.ObjectId(), quantityPerPortion: 1 }],
      });
      mockPredictionRepo.findOne.mockResolvedValue({
        predictedOrders: 70,
        dailyBreakdown: [],
      });
      mockInventoryBatchRepo.findMany.mockResolvedValue([{ quantityRemaining: 200 }]);
      mockWasteReportRepo.findOne.mockResolvedValue(null);
      mockWasteReportRepo.create.mockResolvedValue({ _id: new Types.ObjectId() });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ checkedAt: 'now', itemsAtRisk: [] }),
      }) as any;

      await service.scanSurplus('507f1f77bcf86cd799439011');

      const predFilters = mockPredictionRepo.findOne.mock.calls[0][0].filters;
      expect(predFilters).toHaveProperty('targetWeek');
      expect(predFilters.targetWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.stock[0].category).toBe('معجنات');
    });
  });
});
