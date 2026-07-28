import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { WeeklyPredictionService } from './weekly-prediction.service';
import { SupplierAutoDraftService } from './services/supplier-auto-draft.service';
import { PredictionRepository } from 'src/DB/Repositories/prediction.repository';
import { ProductRepository } from 'src/DB/Repositories/product.repository';
import { SalesTransactionRepository } from 'src/DB/Repositories/sales-transaction.repository';
import { OfferRepository } from 'src/DB/Repositories/offer.repository';
import { UserRepository } from 'src/DB/Repositories/user.repository';
import { RestaurantRepository } from 'src/DB/Repositories/restaurant.repository';
import { Prediction } from 'src/DB/Models/prediction.model';
import { ConfidenceLevelEnum, PredictionSourceEnum } from 'src/Common/Types';

describe('WeeklyPredictionService - Phase 6 AI Integration & Fallback Tests', () => {
  let service: WeeklyPredictionService;
  let mockPredictionRepo: any;
  let mockProductRepo: any;
  let mockSalesRepo: any;
  let mockOfferRepo: any;
  let mockUserRepo: any;
  let mockRestaurantRepo: any;
  let mockSupplierAutoDraftService: any;
  let mockPredictionModel: any;

  const mockRestaurantId = new Types.ObjectId();
  const mockProductId = new Types.ObjectId();
  const targetWeek = '2026-07-27';

  beforeEach(async () => {
    mockPredictionRepo = {
      findOne: jest.fn(),
      findMany: jest.fn(),
      findManyPaginated: jest.fn(),
    };
    mockProductRepo = {
      findOne: jest.fn(),
      findMany: jest.fn(),
    };
    mockSalesRepo = {
      findMany: jest.fn(),
      countDocuments: jest.fn(),
    };
    mockOfferRepo = {
      findOne: jest.fn(),
    };
    mockUserRepo = {
      findOne: jest.fn(),
    };
    mockRestaurantRepo = {
      findOne: jest.fn(),
      findMany: jest.fn(),
    };
    mockSupplierAutoDraftService = {
      generateAutoDrafts: jest.fn().mockResolvedValue({
        draftPurchaseOrders: [],
        unassignedShortfalls: [],
      }),
    };
    mockPredictionModel = {
      findOne: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeeklyPredictionService,
        { provide: PredictionRepository, useValue: mockPredictionRepo },
        { provide: ProductRepository, useValue: mockProductRepo },
        { provide: SalesTransactionRepository, useValue: mockSalesRepo },
        { provide: OfferRepository, useValue: mockOfferRepo },
        { provide: UserRepository, useValue: mockUserRepo },
        { provide: RestaurantRepository, useValue: mockRestaurantRepo },
        {
          provide: SupplierAutoDraftService,
          useValue: mockSupplierAutoDraftService,
        },
        {
          provide: getModelToken(Prediction.name),
          useValue: mockPredictionModel,
        },
      ],
    }).compile();

    service = module.get<WeeklyPredictionService>(WeeklyPredictionService);

    // Mock global fetch to simulate AI endpoint failure
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('AI endpoint unreachable'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should trigger fallback_naive logic when AI call fails after 3 retries', async () => {
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Baklava',
      category: { name: 'Dessert' },
    });

    mockSalesRepo.findMany
      .mockResolvedValueOnce([{ quantitySold: 70 }]) // 14-day rolling window
      .mockResolvedValueOnce([{ quantitySold: 350 }]); // Last week equivalent period

    mockOfferRepo.findOne.mockResolvedValue(null); // No active promotion
    mockPredictionModel.findOne.mockResolvedValue(null); // New prediction

    mockPredictionModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    );

    const result = await service.recalculateProductPrediction(
      mockRestaurantId,
      mockProductId,
      targetWeek,
    );

    // Verification: source MUST be fallback_naive, confidence MUST be low
    expect(result.source).toBe(PredictionSourceEnum.FALLBACK_NAIVE);
    expect(result.confidence).toBe(ConfidenceLevelEnum.LOW);
    expect(result.predictedOrders).toBe(350);
  });

  it('should check promotionActive from Offer collection', async () => {
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Kebab',
      category: { name: 'Grill' },
    });

    mockOfferRepo.findOne.mockResolvedValue({ _id: new Types.ObjectId() }); // Offer found!

    const isPromo = await service.checkPromotionActive(
      mockRestaurantId,
      mockProductId,
      targetWeek,
    );

    expect(isPromo).toBe(true);
    expect(mockOfferRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          restaurantId: mockRestaurantId,
          productId: mockProductId,
        }),
      }),
    );
  });

  it('queries sales history on the `date` field, not `transactionDate`', async () => {
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Baklava',
      category: { name: 'Dessert' },
    });
    mockSalesRepo.findMany.mockResolvedValue([]);
    mockOfferRepo.findOne.mockResolvedValue(null);
    mockPredictionModel.findOne.mockResolvedValue(null);
    mockPredictionModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    );

    await service.recalculateProductPrediction(
      mockRestaurantId,
      mockProductId,
      targetWeek,
    );

    // global.fetch is mocked to reject in beforeEach, so the fallback path runs
    // and BOTH sales lookups fire. Assert the count first — without it an empty
    // mock.calls array would make the loop below pass vacuously.
    expect(mockSalesRepo.findMany).toHaveBeenCalledTimes(2);
    for (const call of mockSalesRepo.findMany.mock.calls) {
      const filters = call[0].filters;
      expect(filters).toHaveProperty('date');
      expect(filters).not.toHaveProperty('transactionDate');
    }
  });

  it('sends a fractional avgDailySales instead of rounding it to zero', async () => {
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Slow Seller',
      category: { name: 'Bread' },
    });
    // 6 units over the 14-day window -> 0.43/day, which must not round to 0.
    mockSalesRepo.findMany.mockResolvedValue([{ quantitySold: 6 }]);
    mockOfferRepo.findOne.mockResolvedValue(null);
    mockPredictionModel.findOne.mockResolvedValue(null);
    mockPredictionModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    );

    const fetchMock = jest.fn().mockRejectedValue(new Error('down'));
    global.fetch = fetchMock as any;

    await service.recalculateProductPrediction(
      mockRestaurantId,
      mockProductId,
      targetWeek,
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.avgDailySales).toBeCloseTo(0.43, 2);
  });

  it('persists the model daily curve instead of flattening it', async () => {
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Croissant',
      category: { name: 'Pastry' },
    });
    mockSalesRepo.findMany.mockResolvedValue([{ quantitySold: 140 }]);
    mockOfferRepo.findOne.mockResolvedValue(null);
    mockPredictionModel.findOne.mockResolvedValue(null);
    mockPredictionModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    );

    const aiBody = {
      modelVersionId: 'restomind-bridge/rule_based-v0.1',
      predictedOrders: 140,
      confidence: 'low',
      featuresUsed: {},
      factors: [],
      dailyBreakdown: [
        { date: '2026-07-27', predictedQuantity: 10, qty: 10 },
        { date: '2026-07-28', predictedQuantity: 12, qty: 12 },
        { date: '2026-07-29', predictedQuantity: 18, qty: 18 },
        { date: '2026-07-30', predictedQuantity: 20, qty: 20 },
        { date: '2026-07-31', predictedQuantity: 30, qty: 30 },
        { date: '2026-08-01', predictedQuantity: 28, qty: 28 },
        { date: '2026-08-02', predictedQuantity: 22, qty: 22 },
      ],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => aiBody,
    }) as any;

    const result = await service.recalculateProductPrediction(
      mockRestaurantId,
      mockProductId,
      targetWeek,
    );

    expect(result.dailyBreakdown.map((d: any) => d.predictedQuantity)).toEqual([
      10, 12, 18, 20, 30, 28, 22,
    ]);
    const sum = result.dailyBreakdown.reduce(
      (a: number, d: any) => a + d.predictedQuantity,
      0,
    );
    expect(sum).toBe(result.predictedOrders);
  });

  it('falls back to the deprecated qty key and preserves the curve, logging a warning', async () => {
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Croissant',
      category: { name: 'Pastry' },
    });
    mockSalesRepo.findMany.mockResolvedValue([{ quantitySold: 140 }]);
    mockOfferRepo.findOne.mockResolvedValue(null);
    mockPredictionModel.findOne.mockResolvedValue(null);
    mockPredictionModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    );

    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});

    // Real-world shape from an AI service that hasn't upgraded yet: only
    // `qty` is present, no `predictedQuantity` key at all.
    const aiBody = {
      modelVersionId: 'restomind-bridge/rule_based-v0.1',
      predictedOrders: 140,
      confidence: 'low',
      featuresUsed: {},
      factors: [],
      dailyBreakdown: [
        { date: '2026-07-27', qty: 10 },
        { date: '2026-07-28', qty: 12 },
        { date: '2026-07-29', qty: 18 },
        { date: '2026-07-30', qty: 20 },
        { date: '2026-07-31', qty: 30 },
        { date: '2026-08-01', qty: 28 },
        { date: '2026-08-02', qty: 22 },
      ],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => aiBody,
    }) as any;

    const result = await service.recalculateProductPrediction(
      mockRestaurantId,
      mockProductId,
      targetWeek,
    );

    expect(result.dailyBreakdown.map((d: any) => d.predictedQuantity)).toEqual([
      10, 12, 18, 20, 30, 28, 22,
    ]);
    expect(
      warn.mock.calls.some((call) => /deprecated 'qty'/.test(String(call[0]))),
    ).toBe(true);
  });

  it('trusts the daily rows and overwrites predictedOrders when the sum disagrees', async () => {
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Croissant',
      category: { name: 'Pastry' },
    });
    mockSalesRepo.findMany.mockResolvedValue([{ quantitySold: 140 }]);
    mockOfferRepo.findOne.mockResolvedValue(null);
    mockPredictionModel.findOne.mockResolvedValue(null);
    mockPredictionModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    );

    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});

    const aiBody = {
      modelVersionId: 'restomind-bridge/rule_based-v0.1',
      predictedOrders: 140,
      confidence: 'low',
      featuresUsed: {},
      factors: [],
      dailyBreakdown: [
        { date: '2026-07-27', predictedQuantity: 10 },
        { date: '2026-07-28', predictedQuantity: 12 },
        { date: '2026-07-29', predictedQuantity: 18 },
        { date: '2026-07-30', predictedQuantity: 15 },
        { date: '2026-07-31', predictedQuantity: 15 },
        { date: '2026-08-01', predictedQuantity: 15 },
        { date: '2026-08-02', predictedQuantity: 15 },
      ],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => aiBody,
    }) as any;

    const result = await service.recalculateProductPrediction(
      mockRestaurantId,
      mockProductId,
      targetWeek,
    );

    expect(result.predictedOrders).toBe(100);
    expect(
      warn.mock.calls.some((call) =>
        /dailyBreakdown sum \(100\) != predictedOrders \(140\)/.test(String(call[0])),
      ),
    ).toBe(true);
  });

  it('rejects a well-formed but impossible targetWeek', () => {
    expect(service.resolveTargetWeek('2025-13-45')).not.toBe('2025-13-45');
    expect(service.resolveTargetWeek('2026-02-30')).not.toBe('2026-02-30');
  });

  it('accepts a real targetWeek unchanged', () => {
    expect(service.resolveTargetWeek('2026-08-02')).toBe('2026-08-02');
  });

  it('resolves the next Sunday as a Cairo calendar date', () => {
    const resolved = service.resolveTargetWeek();
    expect(resolved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Interpreted at UTC noon so the check cannot straddle a day boundary.
    const [y, m, d] = resolved.split('-').map(Number);
    expect(new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()).toBe(0);
  });
});
