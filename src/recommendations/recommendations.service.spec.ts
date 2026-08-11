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
  DailyProductionPlanRepository,
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
import { ProductCostService } from 'src/Common/Services/product-cost.service';
import { getBusinessDayRange } from 'src/Common/Utils/date.util';

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
  let mockDailyProductionPlanRepo: any;
  let mockProductCostService: any;
  let planFor: (productId: Types.ObjectId, recommendedQty: number) => void;

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
      // Default: nothing sold yet today, and no history for the avgDailySales
      // fallback lookback. Tests that care about either override explicitly.
      findMany: jest.fn().mockResolvedValue([]),
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

    mockDailyProductionPlanRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    mockProductCostService = {
      getUnitCost: jest.fn().mockResolvedValue(null),
      getUnitCosts: jest.fn().mockResolvedValue(new Map()),
    };

    // A product only reaches the AI surplus call when a manager has confirmed
    // today's actual production (actualProducedQty) -- recommendedQty alone is
    // a planned target, not real stock on hand, and comparing it back against
    // the same demand basis it was derived from can never signal real risk.
    // `planFor` assumes production matched the plan exactly, which is the
    // simplest fixture for tests that are not specifically exercising the
    // planned-vs-actual distinction.
    planFor = (productId: Types.ObjectId, recommendedQty: number) =>
      mockDailyProductionPlanRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        restaurantId: mockRestaurantId,
        items: [
          {
            productId,
            recommendedQty,
            actualProducedQty: recommendedQty,
          },
        ],
      });

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
        {
          provide: DailyProductionPlanRepository,
          useValue: mockDailyProductionPlanRepo,
        },
        { provide: ProductCostService, useValue: mockProductCostService },
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

    it('scopes the overlapping-offer check to the caller restaurant', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        restaurantId: mockRestaurantId,
      });
      mockRecommendationRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        productId: mockProductId,
        status: 'pending',
        type: 'apply_discount',
        suggestedValue: 20,
      });
      mockProductRepo.findOne.mockResolvedValue({
        _id: mockProductId,
        price: 100,
      });
      mockOfferRepo.findMany.mockResolvedValue([]);
      mockOfferRepo.create.mockResolvedValue({ _id: new Types.ObjectId() });
      mockRecommendationRepo.update.mockResolvedValue({});

      await service.approveRecommendation(
        new Types.ObjectId().toString(),
        '507f1f77bcf86cd799439011',
        {},
      );

      expect(mockOfferRepo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({ restaurantId: mockRestaurantId }),
        }),
      );
    });

    it('clamps a runaway suggestedValue so the offer price stays positive', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        restaurantId: mockRestaurantId,
      });
      mockRecommendationRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        productId: mockProductId,
        status: 'edited',
        type: 'apply_discount',
        suggestedValue: 500, // legacy row written before the DTO cap
      });
      mockProductRepo.findOne.mockResolvedValue({
        _id: mockProductId,
        price: 100,
      });
      mockOfferRepo.findMany.mockResolvedValue([]);
      mockOfferRepo.create.mockImplementation((doc: any) =>
        Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
      );
      mockRecommendationRepo.update.mockResolvedValue({});

      const result = await service.approveRecommendation(
        new Types.ObjectId().toString(),
        '507f1f77bcf86cd799439011',
        {},
      );

      expect(result.offer.discountPercentage).toBeLessThanOrEqual(100);
      expect(result.offer.offerPrice).toBeGreaterThanOrEqual(0);
    });
  });

  describe('scanSurplus & validatePlan graceful AI failure', () => {
    it('should return early message when no product has a demand estimate (recipe not required)', async () => {
      mockProductRepo.findMany.mockResolvedValue([mockProduct]);
      // No recipe -- and, per the fix, that alone no longer excludes the
      // product. It's excluded here because there is also no prediction, no
      // production plan, and no sales history to estimate demand from.
      mockRecipeRepo.findOne.mockResolvedValue(null);

      const result = await service.scanSurplus(mockUserId);

      expect(result.data).toHaveProperty(
        'message',
        'No products with a ready-to-sell source found for surplus scan',
      );
      expect(result.data).toHaveProperty('scannedCount', 0);
      expect(result.degraded).toBe(false);
    });

    it('should return a degraded response (not throw) when surplus scan AI service is unreachable', async () => {
      mockProductRepo.findMany.mockResolvedValue([mockProduct]);
      mockRecipeRepo.findOne.mockResolvedValue(mockRecipe);
      mockPredictionRepo.findOne.mockResolvedValue(null);
      planFor(mockProductId, 40);
      mockInventoryBatchRepo.findMany.mockResolvedValue([]);

      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const result = await service.scanSurplus(mockUserId);

      expect(result.degraded).toBe(true);
      expect((result as any).degradedReason).toContain('Network error');
    });

    it('should send closeHour as integer 22 to AI service during scanSurplus', async () => {
      mockProductRepo.findMany.mockResolvedValue([mockProduct]);
      mockRecipeRepo.findOne.mockResolvedValue(mockRecipe);
      mockPredictionRepo.findOne.mockResolvedValue(null);
      planFor(mockProductId, 40);
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

      // Confirmed production, so the product reaches the AI call.
      planFor(mockProductId, 100);

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
      // predictedOrders is a WEEKLY total, so today's demand is 100/7 = 14.
      // Multiplying the weekly figure by quantityPerPortion overstated one
      // day's consumption sevenfold.
      // expectedConsumption = 14 * 0.2 = 2.8
      // expectedSurplus = 120 - 2.8 = 117.2
      // surplusRatio = 117.2 / 120 = 0.977 -> riskLevel = HIGH (>= 0.7)

      expect(mockWasteReportRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId: mockRestaurantId,
          usableAvailableStock: 120,
          expectedConsumption: 2.8,
          expectedSurplus: 117.2,
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
      planFor(mockProductId, 50);
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

    it('refreshes an edited recommendation instead of creating a duplicate pending one', async () => {
      const editedRecommendation = {
        ...mockRecommendation,
        status: RecommendationStatusEnum.EDITED,
        suggestedValue: 35,
      };

      mockProductRepo.findMany.mockResolvedValue([mockProduct]);
      mockRecipeRepo.findOne.mockResolvedValue(null);
      mockPredictionRepo.findOne.mockResolvedValue(null);
      planFor(mockProductId, 40);
      mockRecommendationRepo.findOne.mockResolvedValue(editedRecommendation);
      mockRecommendationRepo.update.mockImplementation(({ body }: any) =>
        Promise.resolve({ ...editedRecommendation, ...body }),
      );

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            checkedAt: 'now',
            itemsAtRisk: [
              {
                productId: mockProductId.toString(),
                projectedSurplus: 12,
                suggestedDiscountPct: 25,
              },
            ],
          }),
      }) as any;

      const result = await service.scanSurplus(mockUserId);

      expect(mockRecommendationRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({
            status: {
              $in: [
                RecommendationStatusEnum.PENDING,
                RecommendationStatusEnum.EDITED,
              ],
            },
          }),
        }),
      );
      expect(mockRecommendationRepo.create).not.toHaveBeenCalled();
      expect(mockRecommendationRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: { _id: editedRecommendation._id },
          body: expect.objectContaining({
            suggestedValue: 25,
            suggestedQuantity: 12,
          }),
        }),
      );
      expect(result.data.recommendations[0].suggestedValue).toBe(25);
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

    it('creates a recommendation for a product with no recipe at all', async () => {
      mockProductRepo.findMany.mockResolvedValue([mockProduct]);
      // No recipe -- recommendations no longer require one.
      mockRecipeRepo.findOne.mockResolvedValue(null);
      mockPredictionRepo.findOne.mockResolvedValue(null);
      planFor(mockProductId, 40);

      mockRecommendationRepo.findOne.mockResolvedValue(null);
      mockRecommendationRepo.create.mockImplementation((doc: any) =>
        Promise.resolve({ ...doc, _id: new Types.ObjectId() }),
      );

      const mockFetchResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          itemsAtRisk: [
            { productId: mockProductId.toString(), suggestedDiscountPct: 20 },
          ],
        }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse as any);

      const result = await service.scanSurplus(mockUserId);

      // No recipe -> no ingredient-level check at all -> no WasteReport, but
      // the AI's itemsAtRisk is still trusted (currentStock was real) and a
      // recommendation is created with no wasteReportId.
      expect(mockWasteReportRepo.create).not.toHaveBeenCalled();
      expect(mockRecommendationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId: mockRestaurantId,
          productId: mockProductId,
          wasteReportId: null,
          suggestedValue: 20,
        }),
      );
      expect(result.data.recommendations).toHaveLength(1);
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
      // Confirmed production, so the product carries a real currentStock and
      // reaches the AI call -- the prediction above still drives avgDailySales
      // (a separate code path), unaffected by this.
      planFor(mockProductId, 100);

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
      // avgDailySales = (10+15+20+10+15+20+10) / 7 = 100/7 = 14.29 (2dp).
      // Deliberately NOT rounded to a whole unit: integer rounding is what
      // sent 0 for every product forecast under 4 units/week.
      expect(fetchCallBody.stock[0].avgDailySales).toBeCloseTo(14.29, 2);
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

    it('validates a real restaurant product plan by productId using stored predictions', async () => {
      mockProductRepo.findOne.mockResolvedValue(mockProduct);
      mockProductCostService.getUnitCost.mockResolvedValue(7);
      mockPredictionRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        productId: mockProductId,
        predictedOrders: 140,
        factors: [{ factor: 'weekend', impact_pct: 10, direction: 'increase' }],
        dailyBreakdown: [
          { date: '2026-08-09', predictedQuantity: 20 },
          { date: '2026-08-10', predictedQuantity: 20 },
          { date: '2026-08-11', predictedQuantity: 20 },
          { date: '2026-08-12', predictedQuantity: 20 },
          { date: '2026-08-13', predictedQuantity: 20 },
          { date: '2026-08-14', predictedQuantity: 20 },
          { date: '2026-08-15', predictedQuantity: 20 },
        ],
      });

      const result = await service.validatePlan(mockUserId, {
        productId: mockProductId.toString(),
        date: '2026-08-10',
        planned_quantity: 30,
      });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockPredictionRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({
            restaurantId: mockRestaurantId,
            productId: mockProductId,
            targetWeek: '2026-08-09',
          }),
        }),
      );
      expect(result).toMatchObject({
        degraded: false,
        data: {
          productId: mockProductId.toString(),
          planned_qty: 30,
          forecast_qty: 20,
          forecast_upper: 22,
          excess_qty: 8,
          severity: 'medium',
          projected_waste_cost_egp: 56,
        },
      });
    });

    it('rejects productId validation when no prediction or plan baseline exists', async () => {
      mockProductRepo.findOne.mockResolvedValue(mockProduct);
      mockPredictionRepo.findOne.mockResolvedValue(null);
      mockDailyProductionPlanRepo.findOne.mockResolvedValue(null);

      await expect(
        service.validatePlan(mockUserId, {
          productId: mockProductId.toString(),
          date: '2026-08-10',
          planned_quantity: 30,
        }),
      ).rejects.toThrow(BadRequestException);
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
      planFor(mockProductId, 100);
      mockInventoryBatchRepo.findMany.mockResolvedValue([
        { quantityRemaining: 500 },
      ]);
      mockWasteReportRepo.findOne.mockResolvedValue(null);
      mockWasteReportRepo.create.mockResolvedValue({
        _id: new Types.ObjectId(),
      });

      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED')) as any;

      const result = await service.scanSurplus('507f1f77bcf86cd799439011');

      expect(result.degraded).toBe(true);
      expect((result as any).degradedReason).toContain('ECONNREFUSED');

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
        ingredients: [
          { ingredientId: new Types.ObjectId(), quantityPerPortion: 1 },
        ],
      });
      mockPredictionRepo.findOne.mockResolvedValue({
        predictedOrders: 70,
        dailyBreakdown: [],
      });
      planFor(mockProductId, 70);
      mockInventoryBatchRepo.findMany.mockResolvedValue([
        { quantityRemaining: 200 },
      ]);
      mockWasteReportRepo.findOne.mockResolvedValue(null);
      mockWasteReportRepo.create.mockResolvedValue({
        _id: new Types.ObjectId(),
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ checkedAt: 'now', itemsAtRisk: [] }),
      }) as any;

      await service.scanSurplus('507f1f77bcf86cd799439011');

      const predFilters = mockPredictionRepo.findOne.mock.calls[0][0].filters;
      expect(predFilters).toHaveProperty('targetWeek');
      expect(predFilters.targetWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const body = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body,
      );
      expect(body.stock[0].category).toBe('معجنات');
    });

    it('links each waste report back to the prediction that drove it', async () => {
      const predictionId = new Types.ObjectId();
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
        },
      ]);
      mockRecipeRepo.findOne.mockResolvedValue({
        ingredients: [
          { ingredientId: new Types.ObjectId(), quantityPerPortion: 1 },
        ],
      });
      mockPredictionRepo.findOne.mockResolvedValue({
        _id: predictionId,
        predictedOrders: 70,
        dailyBreakdown: [],
      });
      mockInventoryBatchRepo.findMany.mockResolvedValue([
        { quantityRemaining: 200 },
      ]);
      mockWasteReportRepo.findOne.mockResolvedValue(null);
      mockWasteReportRepo.create.mockResolvedValue({
        _id: new Types.ObjectId(),
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ checkedAt: 'now', itemsAtRisk: [] }),
      }) as any;

      await service.scanSurplus('507f1f77bcf86cd799439011');

      expect(mockWasteReportRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ predictionId }),
      );
    });

    it('dedups waste reports over one CAIRO day, not the server local day', async () => {
      // F6. `setHours(0,0,0,0)` / `setHours(23,59,59,999)` on a server-local
      // Date meant that on a UTC container a scan at Cairo 01:00 and one at
      // Cairo 10:00 the same Cairo day fell in different windows and wrote two
      // reports per ingredient — double-counting getSummary's $sum on
      // totalEstimatedWasteCost. Same assertion shape as the reconciliation
      // window test in weekly-prediction.service.spec.ts.
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
        },
      ]);
      mockRecipeRepo.findOne.mockResolvedValue({
        ingredients: [
          { ingredientId: new Types.ObjectId(), quantityPerPortion: 1 },
        ],
      });
      mockPredictionRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        predictedOrders: 70,
        dailyBreakdown: [],
      });
      mockInventoryBatchRepo.findMany.mockResolvedValue([
        { quantityRemaining: 200 },
      ]);
      mockWasteReportRepo.findOne.mockResolvedValue(null);
      mockWasteReportRepo.create.mockResolvedValue({
        _id: new Types.ObjectId(),
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ checkedAt: 'now', itemsAtRisk: [] }),
      }) as any;

      // Frozen so the expected bounds can be written as absolute instants
      // rather than recomputed with the same helpers the service uses (which
      // would only prove self-consistency). 09:00Z is 12:00 in Cairo on
      // 2026-07-29, comfortably inside the day from either zone's point of
      // view, so the assertion is not a boundary special case.
      jest.useFakeTimers({ now: new Date('2026-07-29T09:00:00.000Z') });
      try {
        await service.scanSurplus('507f1f77bcf86cd799439011');
      } finally {
        jest.useRealTimers();
      }

      const filters = mockWasteReportRepo.findOne.mock.calls[0][0].filters;

      // The Cairo day 2026-07-29 is [2026-07-28T21:00Z, 2026-07-29T21:00Z) in
      // summer (UTC+3). Written out rather than derived: under the suite's
      // pinned TZ=UTC the server-local day would be
      // [2026-07-29T00:00Z, 2026-07-30T00:00Z), so these literals discriminate
      // between the two unconditionally — no `if` guard, on any machine.
      expect(filters.createdAt.$gte.toISOString()).toBe(
        '2026-07-28T21:00:00.000Z',
      );
      expect(filters.createdAt.$lt.toISOString()).toBe(
        '2026-07-29T21:00:00.000Z',
      );

      // Half-open and exactly one Cairo day wide. The old code used an
      // inclusive `$lte ...23:59:59.999` upper bound; this pins the shape too.
      expect(Object.keys(filters.createdAt).sort()).toEqual(['$gte', '$lt']);

      // Belt and braces: still agrees with the helper the service uses.
      const { start, end } = getBusinessDayRange('2026-07-29');
      expect(filters.createdAt).toEqual({ $gte: start, $lt: end });
    });
  });
});
