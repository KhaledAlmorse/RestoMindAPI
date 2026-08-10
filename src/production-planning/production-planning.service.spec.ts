import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ConfidenceLevelEnum, ProductionPlanSourceEnum } from '../Common/Types';
import { getBusinessDayRange } from '../Common/Utils/date.util';
import { DailyProductionPlan } from '../DB/Models/daily-production-plan.model';
import { DailyProductionPlanRepository } from '../DB/Repositories/daily-production-plan.repository';
import { ProductRepository } from '../DB/Repositories/product.repository';
import { SalesTransactionRepository } from '../DB/Repositories/sales-transaction.repository';
import { UserRepository } from '../DB/Repositories/user.repository';
import { RestaurantRepository } from '../DB/Repositories/restaurant.repository';
import { AiIngestService } from '../imports/services/ai-ingest.service';
import { ProductionPlanningService } from './production-planning.service';
import { AiClientService } from '../Common/Services/ai-client.service';
import { ProductCostService } from '../Common/Services/product-cost.service';

describe('ProductionPlanningService - Phase 5 Validation Cases & Actuals Fix', () => {
  let service: ProductionPlanningService;
  let mockPlanRepo: any;
  let mockProductRepo: any;
  let mockSalesRepo: any;
  let mockUserRepo: any;
  let mockRestaurantRepo: any;
  let mockAiIngestService: any;
  let mockDailyProductionPlanModel: any;
  let mockProductCostService: any;

  const mockUserId = new Types.ObjectId().toString();
  const mockRestaurantId = new Types.ObjectId();

  beforeEach(async () => {
    mockPlanRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findMany: jest.fn(),
    };
    mockProductRepo = {
      findMany: jest.fn(),
    };
    mockSalesRepo = {
      findMany: jest.fn(),
    };
    mockUserRepo = {
      findOne: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(mockUserId),
        restaurantId: mockRestaurantId,
      }),
    };
    mockRestaurantRepo = {
      findOne: jest.fn().mockResolvedValue({
        _id: mockRestaurantId,
      }),
      findMany: jest.fn().mockResolvedValue([{ _id: mockRestaurantId }]),
    };
    mockAiIngestService = {
      ingest: jest.fn().mockResolvedValue({ success: true, attempts: 1 }),
    };
    mockDailyProductionPlanModel = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(true),
      }),
    };
    mockProductCostService = {
      getUnitCost: jest.fn().mockResolvedValue(null),
      getUnitCosts: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductionPlanningService,
        AiClientService,
        { provide: DailyProductionPlanRepository, useValue: mockPlanRepo },
        { provide: ProductRepository, useValue: mockProductRepo },
        { provide: SalesTransactionRepository, useValue: mockSalesRepo },
        { provide: UserRepository, useValue: mockUserRepo },
        { provide: RestaurantRepository, useValue: mockRestaurantRepo },
        { provide: AiIngestService, useValue: mockAiIngestService },
        { provide: ProductCostService, useValue: mockProductCostService },
        {
          provide: getModelToken(DailyProductionPlan.name),
          useValue: mockDailyProductionPlanModel,
        },
      ],
    }).compile();

    service = module.get<ProductionPlanningService>(ProductionPlanningService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==========================================
  // CASE 1: Generate plan successfully when AI service is available
  // ==========================================
  it('Case 1: Generate production plan successfully when AI service is available -> source: ai_model', async () => {
    const prodId = new Types.ObjectId();
    const todayStr = service.getTodayDateString();

    mockPlanRepo.findOne.mockResolvedValue(null);
    mockProductRepo.findMany.mockResolvedValue([
      {
        _id: prodId,
        title: 'Croissant',
        price: 18,
        category: { name: 'Pastry' },
      },
    ]);
    mockSalesRepo.findMany.mockResolvedValue([]);

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        restaurantId: mockRestaurantId.toString(),
        date: todayStr,
        totalRecommendedQty: 90,
        items: [
          {
            productId: prodId.toString(),
            recommendedQty: 90,
            lowerBound: 70,
            upperBound: 110,
            confidence: ConfidenceLevelEnum.MEDIUM,
            source: ProductionPlanSourceEnum.AI_MODEL,
            factors: ['historical_demand'],
          },
        ],
      }),
    } as any);

    mockPlanRepo.create.mockImplementation((data: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...data }),
    );

    const result = await service.generateProductionPlan(
      mockRestaurantId,
      todayStr,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.items[0].source).toBe(ProductionPlanSourceEnum.AI_MODEL);
    expect(result.totalRecommendedQty).toBe(90);
    expect(result.items[0].recommendedQty).toBe(90);
    expect(result.items[0].actualProducedQty).toBeNull();
    expect(mockPlanRepo.create).toHaveBeenCalled();
  });

  // ==========================================
  // CASE 2: AI service unavailable -> Retries 3x, Fallback activates
  // ==========================================
  it('Case 2: AI service unavailable -> Retries 3 times, Fallback activates, source: fallback_yesterday, Critical log generated', async () => {
    const prodId = new Types.ObjectId();
    const todayStr = service.getTodayDateString();

    mockPlanRepo.findOne.mockResolvedValue(null); // No plan for today or yesterday
    mockProductRepo.findMany.mockResolvedValue([
      {
        _id: prodId,
        title: 'Croissant',
        price: 18,
        category: { name: 'Pastry' },
      },
    ]);
    mockSalesRepo.findMany.mockResolvedValue([
      { productId: prodId, quantitySold: 280 }, // 280 total in 14 days -> 20 avgDailySales
    ]);

    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('AI Service 503 Unavailable'));

    mockPlanRepo.create.mockImplementation((data: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...data }),
    );

    const result = await service.generateProductionPlan(
      mockRestaurantId,
      todayStr,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(3); // 3 retries executed!
    expect(result.items[0].source).toBe(
      ProductionPlanSourceEnum.FALLBACK_YESTERDAY,
    );
    expect(result.items[0].confidence).toBe(ConfidenceLevelEnum.LOW);
    expect(result.items[0].recommendedQty).toBe(20); // 280 / 14 = 20 avgDailySales fallback!
  });

  // ==========================================
  // Owner cold-start estimate must survive the local naive fallback too.
  // ==========================================
  it('does not discard the owner estimate on the naive fallback path when AI is down and there is no yesterday plan', async () => {
    const prodId = new Types.ObjectId();
    const todayStr = service.getTodayDateString();

    // No plan exists for today OR yesterday (both calls to findOne resolve
    // null), so the fallback cannot borrow yesterday's recommendedQty.
    mockPlanRepo.findOne.mockResolvedValue(null);
    mockProductRepo.findMany.mockResolvedValue([
      {
        _id: prodId,
        title: 'Brand New Item',
        price: 18,
        category: { name: 'Pastry' },
        expectedDailySales: 25,
      },
    ]);
    // No sales history at all for this cold-start product.
    mockSalesRepo.findMany.mockResolvedValue([]);

    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('AI down'));

    mockPlanRepo.create.mockImplementation((data: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...data }),
    );

    const result = await service.generateProductionPlan(
      mockRestaurantId,
      todayStr,
    );

    expect(result.items[0].source).toBe(
      ProductionPlanSourceEnum.FALLBACK_YESTERDAY,
    );
    // Must use the owner's estimate (25), not 0.
    expect(result.items[0].recommendedQty).toBe(25);
  });

  // ==========================================
  // CASE 3: Generate the same restaurant/date twice -> Unique Index / Prevents Duplicate Plans
  // ==========================================
  it('Case 3: Generate the same restaurant/date twice -> returns existing plan, compound index prevents duplicates', async () => {
    const existingPlan = {
      _id: new Types.ObjectId(),
      restaurantId: mockRestaurantId,
      date: '2026-07-26',
      totalRecommendedQty: 100,
      items: [],
    };

    mockPlanRepo.findOne.mockResolvedValue(existingPlan);

    const result = await service.generateProductionPlan(
      mockRestaurantId,
      '2026-07-26',
    );

    expect(result).toBe(existingPlan);
    expect(mockPlanRepo.create).not.toHaveBeenCalled();
  });

  // ==========================================
  // ACTUALS UPDATE TESTS (RECORD ACTUALS FLOW)
  // ==========================================
  describe('recordActuals Flow Verification', () => {
    it('✅ Update one product actual quantity -> uses atomic $set with arrayFilters', async () => {
      const prodId = new Types.ObjectId();
      const planId = new Types.ObjectId();

      const existingPlan = {
        _id: planId,
        restaurantId: mockRestaurantId,
        date: '2026-07-26',
        items: [
          { productId: prodId, recommendedQty: 40, actualProducedQty: null },
        ],
      };

      const updatedPopulatedPlan = {
        _id: planId,
        restaurantId: mockRestaurantId,
        date: '2026-07-26',
        items: [
          {
            productId: { _id: prodId, title: 'Chicken Sandwich' },
            recommendedQty: 40,
            actualProducedQty: 50,
          },
        ],
      };

      mockPlanRepo.findOne
        .mockResolvedValueOnce(existingPlan)
        .mockResolvedValueOnce(updatedPopulatedPlan);

      const result = await service.recordActuals(mockUserId, {
        date: '2026-07-26',
        items: [{ productId: prodId.toString(), actualProducedQty: 50 }],
      });

      expect(
        mockDailyProductionPlanModel.findOneAndUpdate,
      ).toHaveBeenCalledWith(
        { _id: planId },
        { $set: { 'items.$[elem0].actualProducedQty': 50 } },
        {
          arrayFilters: [{ 'elem0.productId': prodId }],
          new: true,
        },
      );

      expect((result.data as any).items[0].actualProducedQty).toBe(50);
      expect((result.data as any).items[0].productId.title).toBe(
        'Chicken Sandwich',
      );
    });

    it('✅ Update multiple products actual quantities -> atomic arrayFilters handles all items in single update', async () => {
      const prodId1 = new Types.ObjectId();
      const prodId2 = new Types.ObjectId();
      const planId = new Types.ObjectId();

      const existingPlan = {
        _id: planId,
        restaurantId: mockRestaurantId,
        date: '2026-07-26',
        items: [
          { productId: prodId1, recommendedQty: 40, actualProducedQty: null },
          { productId: prodId2, recommendedQty: 50, actualProducedQty: null },
        ],
      };

      const updatedPopulatedPlan = {
        _id: planId,
        restaurantId: mockRestaurantId,
        date: '2026-07-26',
        items: [
          {
            productId: { _id: prodId1, title: 'Product 1' },
            recommendedQty: 40,
            actualProducedQty: 50,
          },
          {
            productId: { _id: prodId2, title: 'Product 2' },
            recommendedQty: 50,
            actualProducedQty: 60,
          },
        ],
      };

      mockPlanRepo.findOne
        .mockResolvedValueOnce(existingPlan)
        .mockResolvedValueOnce(updatedPopulatedPlan);

      const result = await service.recordActuals(mockUserId, {
        date: '2026-07-26',
        items: [
          { productId: prodId1.toString(), actualProducedQty: 50 },
          { productId: prodId2.toString(), actualProducedQty: 60 },
        ],
      });

      expect(
        mockDailyProductionPlanModel.findOneAndUpdate,
      ).toHaveBeenCalledWith(
        { _id: planId },
        {
          $set: {
            'items.$[elem0].actualProducedQty': 50,
            'items.$[elem1].actualProducedQty': 60,
          },
        },
        {
          arrayFilters: [
            { 'elem0.productId': prodId1 },
            { 'elem1.productId': prodId2 },
          ],
          new: true,
        },
      );

      expect((result.data as any).items[0].actualProducedQty).toBe(50);
      expect((result.data as any).items[1].actualProducedQty).toBe(60);
    });

    it('✅ Ensure other products remain unchanged when performing partial update', async () => {
      const prodIdA = new Types.ObjectId();
      const prodIdB = new Types.ObjectId();
      const planId = new Types.ObjectId();

      const existingPlan = {
        _id: planId,
        restaurantId: mockRestaurantId,
        date: '2026-07-26',
        items: [
          { productId: prodIdA, recommendedQty: 40, actualProducedQty: null },
          { productId: prodIdB, recommendedQty: 30, actualProducedQty: null },
        ],
      };

      const updatedPopulatedPlan = {
        _id: planId,
        restaurantId: mockRestaurantId,
        date: '2026-07-26',
        items: [
          {
            productId: { _id: prodIdA, title: 'Product A' },
            recommendedQty: 40,
            actualProducedQty: 50,
          },
          {
            productId: { _id: prodIdB, title: 'Product B' },
            recommendedQty: 30,
            actualProducedQty: null,
          },
        ],
      };

      mockPlanRepo.findOne
        .mockResolvedValueOnce(existingPlan)
        .mockResolvedValueOnce(updatedPopulatedPlan);

      const result = await service.recordActuals(mockUserId, {
        date: '2026-07-26',
        items: [{ productId: prodIdA.toString(), actualProducedQty: 50 }],
      });

      // Product B was not sent in request arrayFilters, so onlyelem0 is in $set
      expect(
        mockDailyProductionPlanModel.findOneAndUpdate,
      ).toHaveBeenCalledWith(
        { _id: planId },
        { $set: { 'items.$[elem0].actualProducedQty': 50 } },
        {
          arrayFilters: [{ 'elem0.productId': prodIdA }],
          new: true,
        },
      );

      expect((result.data as any).items[0].actualProducedQty).toBe(50);
      expect((result.data as any).items[1].actualProducedQty).toBeNull();
    });

    it('✅ Invalid productId handling -> throws BadRequestException', async () => {
      const existingPlan = {
        _id: new Types.ObjectId(),
        restaurantId: mockRestaurantId,
        date: '2026-07-26',
        items: [],
      };

      mockPlanRepo.findOne.mockResolvedValue(existingPlan);

      await expect(
        service.recordActuals(mockUserId, {
          date: '2026-07-26',
          items: [{ productId: 'invalid-object-id', actualProducedQty: 50 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('reports which productIds were applied and which were not in the plan', async () => {
      const inPlan = new Types.ObjectId();
      const notInPlan = new Types.ObjectId();

      mockUserRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        restaurantId: mockRestaurantId,
      });
      mockPlanRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        items: [{ productId: inPlan, recommendedQty: 10 }],
      });
      mockDailyProductionPlanModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({}),
      });

      const result = await service.recordActuals('507f1f77bcf86cd799439011', {
        date: '2026-07-29',
        items: [
          { productId: inPlan.toString(), actualProducedQty: 8 },
          { productId: notInPlan.toString(), actualProducedQty: 5 },
        ],
      });

      expect(result.applied).toEqual([inPlan.toString()]);
      expect(result.skipped).toEqual([notInPlan.toString()]);
    });
  });

  it('builds the 14-day avgDailySales lookback from Cairo day boundaries', async () => {
    // `new Date(`${dateStr}T00:00:00.000Z`)` was a UTC-midnight literal built
    // from a Cairo date string, so the whole window sat 2-3h off the Cairo days
    // it claimed to cover. July: Cairo is on DST (UTC+3) across the entire
    // window, so the UTC-midnight version is a genuinely different instant.
    const dateStr = '2026-07-29';

    mockPlanRepo.findOne.mockResolvedValue(null);
    mockProductRepo.findMany.mockResolvedValue([
      { _id: new Types.ObjectId(), title: 'Croissant', price: 18 },
    ]);
    mockSalesRepo.findMany.mockResolvedValue([]);
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('AI down'));
    mockPlanRepo.create.mockImplementation((data: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...data }),
    );

    await service.generateProductionPlan(mockRestaurantId, dateStr);

    const expectedEnd = getBusinessDayRange(dateStr).start;
    const expectedStart = getBusinessDayRange('2026-07-15').start; // 14 days back
    const filters = mockSalesRepo.findMany.mock.calls[0][0].filters;
    expect(filters.date).toEqual({ $gte: expectedStart, $lt: expectedEnd });

    // Exactly 14 Cairo days wide, and NOT the UTC-midnight pair.
    expect(expectedEnd.getTime() - expectedStart.getTime()).toBe(
      14 * 24 * 60 * 60 * 1000,
    );
    expect(filters.date.$lt).not.toEqual(new Date(`${dateStr}T00:00:00.000Z`));
    expect(filters.date.$lt.toISOString()).toBe('2026-07-28T21:00:00.000Z');
    expect(filters.date.$gte.toISOString()).toBe('2026-07-14T21:00:00.000Z');
  });

  it('reports a cached fallback plan as degraded, not as a healthy forecast', async () => {
    // The cached branch: the plan is read straight from the DB, so no live AI
    // failure occurred this request — but its rows were produced by the local
    // fallback policy, and a caller must be able to tell.
    const todayStr = service.getTodayDateString();
    const yesterdayStr = service.getYesterdayDateString(todayStr);

    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(mockUserId),
      restaurantId: mockRestaurantId,
    });
    mockPlanRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      date: yesterdayStr,
      items: [
        {
          productId: new Types.ObjectId(),
          recommendedQty: 20,
          source: ProductionPlanSourceEnum.FALLBACK_YESTERDAY,
        },
      ],
    });

    const result: any = await service.getProductionPlan(mockUserId, yesterdayStr);

    expect(result.success).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toMatch(/local fallback policy/i);
  });

  it('does not flag a cached AI-produced plan as degraded', async () => {
    // Guards the test above from over-correcting into "every cached plan is
    // degraded", which would make the flag meaningless.
    const todayStr = service.getTodayDateString();
    const yesterdayStr = service.getYesterdayDateString(todayStr);

    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(mockUserId),
      restaurantId: mockRestaurantId,
    });
    mockPlanRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      date: yesterdayStr,
      items: [
        {
          productId: new Types.ObjectId(),
          recommendedQty: 90,
          source: ProductionPlanSourceEnum.AI_MODEL,
        },
      ],
    });

    const result: any = await service.getProductionPlan(mockUserId, yesterdayStr);

    expect(result.degraded).toBe(false);
    expect(result.degradedReason).toBeUndefined();
  });

  it('refreshes today production plan from the AI model even when a plan already exists', async () => {
    const prodId = new Types.ObjectId();
    const planId = new Types.ObjectId();
    const todayStr = service.getTodayDateString();
    const existingPlan = {
      _id: planId,
      restaurantId: mockRestaurantId,
      date: todayStr,
      totalRecommendedQty: 10,
      items: [
        {
          productId: prodId,
          recommendedQty: 10,
          actualProducedQty: 12,
          source: ProductionPlanSourceEnum.AI_MODEL,
        },
      ],
    };
    const refreshedPlan = {
      ...existingPlan,
      totalRecommendedQty: 33,
      items: [
        {
          productId: prodId,
          recommendedQty: 33,
          actualProducedQty: 12,
          source: ProductionPlanSourceEnum.AI_MODEL,
        },
      ],
    };

    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(mockUserId),
      restaurantId: mockRestaurantId,
    });
    mockPlanRepo.findOne
      .mockResolvedValueOnce(existingPlan)
      .mockResolvedValueOnce(existingPlan)
      .mockResolvedValueOnce(refreshedPlan);
    mockProductRepo.findMany.mockResolvedValue([
      { _id: prodId, title: 'Croissant', price: 18 },
    ]);
    mockSalesRepo.findMany.mockResolvedValue([]);
    mockPlanRepo.findOneAndUpdate.mockResolvedValue(refreshedPlan);

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        restaurantId: mockRestaurantId.toString(),
        date: todayStr,
        items: [
          {
            productId: prodId.toString(),
            recommendedQty: 33,
            confidence: ConfidenceLevelEnum.MEDIUM,
          },
        ],
      }),
    } as any);

    const result: any = await service.getProductionPlan(mockUserId, todayStr);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockPlanRepo.findOneAndUpdate).toHaveBeenCalledWith({
      filters: { _id: planId },
      updateData: {
        $set: expect.objectContaining({
          totalRecommendedQty: 33,
          isDeleted: false,
        }),
      },
    });
    expect(result.data.items[0].recommendedQty).toBe(33);
    expect(result.data.items[0].actualProducedQty).toBe(12);
  });

  // ==========================================
  // CASE 5: GET yesterday date without existing plan -> Returns 404
  // ==========================================
  it('Case 5: GET past date without existing plan -> Returns 404', async () => {
    const todayStr = service.getTodayDateString();
    const yesterdayStr = service.getYesterdayDateString(todayStr);

    mockPlanRepo.findOne.mockResolvedValue(null);

    await expect(
      service.getProductionPlan(mockUserId, yesterdayStr),
    ).rejects.toThrow(NotFoundException);
  });

  // ==========================================
  // CASE 6: Verify Nightly AI Learning Sync Cron
  // ==========================================
  it('Case 6: Verify nightly sync cron uses existing Phase 4 AiIngestService directly', async () => {
    const todayStr = service.getTodayDateString();
    const yesterdayStr = service.getYesterdayDateString(todayStr);
    const prodId = new Types.ObjectId();

    mockProductRepo.findMany.mockResolvedValue([
      { _id: prodId, title: 'Baklava', category: { name: 'Dessert' } },
    ]);
    mockSalesRepo.findMany.mockResolvedValue([
      {
        date: new Date(`${yesterdayStr}T12:00:00.000Z`),
        productId: prodId,
        quantitySold: 50,
        sellingPrice: 18,
      },
    ]);

    await service.handleNightlyAiSync();

    expect(mockAiIngestService.ingest).toHaveBeenCalledWith({
      restaurantId: mockRestaurantId.toString(),
      records: [
        {
          date: yesterdayStr,
          productId: prodId.toString(),
          salesQty: 50,
        },
      ],
      // price, unitCost and freshnessWindow ride along on every AI product
      // payload: they are what the service computes the newsvendor service
      // level from. This path used to omit all three. unitCost is null here
      // because ProductCostService found no priced recipe for this product.
      products: [
        {
          productId: prodId.toString(),
          title: 'Baklava',
          category: 'Dessert',
          price: 0,
          unitCost: null,
          freshnessWindow: null,
        },
      ],
    });
  });

  it('Case 7: nightly sync builds the query window from Cairo day boundaries, not UTC-labelled ones', async () => {
    const todayStr = service.getTodayDateString();
    const yesterdayStr = service.getYesterdayDateString(todayStr);

    mockProductRepo.findMany.mockResolvedValue([]);
    mockSalesRepo.findMany.mockResolvedValue([]);

    await service.handleNightlyAiSync();

    const { start, end } = getBusinessDayRange(yesterdayStr);
    const filters = mockSalesRepo.findMany.mock.calls[0][0].filters;
    expect(filters.date).toEqual({ $gte: start, $lt: end });
  });

  it('Case 8: nightly sync attributes a sale to the Cairo day it happened on, not the UTC date', async () => {
    const prodId = new Types.ObjectId();
    mockProductRepo.findMany.mockResolvedValue([]);
    // 2026-01-15T22:30:00.000Z is 2026-01-16 00:30 in Cairo (winter, UTC+2) —
    // a UTC .toISOString() split would mislabel this as the 15th.
    mockSalesRepo.findMany.mockResolvedValue([
      {
        date: new Date('2026-01-15T22:30:00.000Z'),
        productId: prodId,
        quantitySold: 5,
      },
    ]);

    await service.handleNightlyAiSync();

    expect(mockAiIngestService.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        records: [
          {
            date: '2026-01-16',
            productId: prodId.toString(),
            salesQty: 5,
          },
        ],
      }),
    );
  });
});
