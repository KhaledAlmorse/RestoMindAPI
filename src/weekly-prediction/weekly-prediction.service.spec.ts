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
import { AiClientService } from 'src/Common/Services/ai-client.service';
import {
  addDaysToDateString,
  getBusinessDateString,
  getBusinessDayOfWeek,
  getBusinessDayRange,
} from 'src/Common/Utils/date.util';

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
        AiClientService,
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
        /dailyBreakdown sum \(100\) != predictedOrders \(140\)/.test(
          String(call[0]),
        ),
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

  it('distributes the fallback total exactly across 7 days when not divisible by 7', async () => {
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Baklava',
      category: { name: 'Dessert' },
    });

    mockSalesRepo.findMany
      .mockResolvedValueOnce([{ quantitySold: 70 }]) // 14-day rolling window
      .mockResolvedValueOnce([{ quantitySold: 100 }]); // Last week equivalent period, not divisible by 7

    mockOfferRepo.findOne.mockResolvedValue(null);
    mockPredictionModel.findOne.mockResolvedValue(null);
    mockPredictionModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    );

    const result = await service.recalculateProductPrediction(
      mockRestaurantId,
      mockProductId,
      targetWeek,
    );

    expect(result.predictedOrders).toBe(100);
    const sum = result.dailyBreakdown.reduce(
      (a: number, d: any) => a + d.predictedQuantity,
      0,
    );
    expect(sum).toBe(100);
  });

  it('treats a short (non-7-row) AI breakdown as unusable and falls through to even distribution', async () => {
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
      predictedOrders: 100,
      confidence: 'low',
      featuresUsed: {},
      factors: [],
      dailyBreakdown: [
        { date: '2026-07-27', predictedQuantity: 30 },
        { date: '2026-07-28', predictedQuantity: 30 },
        { date: '2026-07-29', predictedQuantity: 40 },
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

    expect(result.dailyBreakdown).toHaveLength(7);
    const sum = result.dailyBreakdown.reduce(
      (a: number, d: any) => a + d.predictedQuantity,
      0,
    );
    expect(sum).toBe(result.predictedOrders);
    expect(
      warn.mock.calls.some((call) =>
        /dailyBreakdown had 3 rows/.test(String(call[0])),
      ),
    ).toBe(true);
  });

  it('uses a half-open week window so day 8 does not count as active', async () => {
    mockOfferRepo.findOne.mockResolvedValue(null);

    await service.checkPromotionActive(
      mockRestaurantId,
      mockProductId,
      '2026-07-27',
    );

    const filters = mockOfferRepo.findOne.mock.calls[0][0].filters;
    // The week is the seven CAIRO days beginning 2026-07-27, i.e.
    // [2026-07-26T21:00Z, 2026-08-02T21:00Z) in summer (UTC+3). This test
    // previously pinned the UTC-midnight pair, which is the defect, not the
    // contract — targetWeek is a Cairo calendar date.
    expect(filters.startDate).toEqual({
      $lt: new Date('2026-08-02T21:00:00.000Z'),
    });
    expect(filters.endDate).toEqual({
      $gte: new Date('2026-07-26T21:00:00.000Z'),
    });
    // Still exactly seven days wide.
    expect(
      filters.startDate.$lt.getTime() - filters.endDate.$gte.getTime(),
    ).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('reads the naive fallback last-week window as Cairo days, not UTC midnight', async () => {
    // This window produces predictedOrders for exactly the fallback_naive rows
    // the endpoint labels as degraded. targetWeek is a Cairo calendar date, so
    // a UTC-midnight literal named an instant 3h (summer) away from the week
    // it claims — the label was right while the number under it was skewed.
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
    // beforeEach mocks fetch to reject, so the naive fallback path runs.

    await service.recalculateProductPrediction(
      mockRestaurantId,
      mockProductId,
      '2026-07-27',
    );

    // Two sales lookups fire: [0] the 14-day rolling window, [1] the
    // last-week equivalent period. Assert the count first so the index below
    // cannot pass vacuously.
    expect(mockSalesRepo.findMany).toHaveBeenCalledTimes(2);
    const lastWeek = mockSalesRepo.findMany.mock.calls[1][0].filters;

    // The seven Cairo days before 2026-07-27, i.e. the Cairo week starting
    // 2026-07-20: [2026-07-19T21:00Z, 2026-07-26T21:00Z) in summer (UTC+3).
    expect(lastWeek.date.$gte.toISOString()).toBe('2026-07-19T21:00:00.000Z');
    expect(lastWeek.date.$lt.toISOString()).toBe('2026-07-26T21:00:00.000Z');
    expect(lastWeek.date.$lt.getTime() - lastWeek.date.$gte.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
    // Explicitly not the UTC-midnight pair this used to build.
    expect(lastWeek.date.$gte).not.toEqual(
      new Date('2026-07-20T00:00:00.000Z'),
    );
    expect(lastWeek.date.$lt).not.toEqual(new Date('2026-07-27T00:00:00.000Z'));
  });

  it('backfills sales history to the AI with product metadata attached', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      restaurantId: mockRestaurantId,
    });
    mockProductRepo.findMany.mockResolvedValue([
      { _id: mockProductId, title: 'Croissant', category: { name: 'معجنات' } },
    ]);
    mockSalesRepo.findMany.mockResolvedValue([
      {
        productId: mockProductId,
        date: new Date('2026-06-01T10:00:00Z'),
        quantitySold: 12,
      },
      {
        productId: mockProductId,
        date: new Date('2026-06-02T10:00:00Z'),
        quantitySold: 15,
      },
    ]);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        learnedLevels: { [mockProductId.toString()]: 13.5 },
      }),
    }) as any;

    const result = await service.backfillAiHistory(
      '507f1f77bcf86cd799439011',
      90,
    );

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.records).toHaveLength(2);
    expect(body.records[0]).toEqual({
      date: '2026-06-01',
      productId: mockProductId.toString(),
      salesQty: 12,
    });
    // Category must ride along, or the model falls back to neutral priors.
    expect(body.products[0]).toMatchObject({
      productId: mockProductId.toString(),
      title: 'Croissant',
      category: 'معجنات',
    });
    expect(result.rowsSent).toBe(2);
  });

  it('backfill attributes a late-evening Cairo sale to the correct calendar day', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      restaurantId: mockRestaurantId,
    });
    mockProductRepo.findMany.mockResolvedValue([
      { _id: mockProductId, title: 'Croissant', category: { name: 'Pastry' } },
    ]);
    // 2026-07-15T22:30:00.000Z is 2026-07-16 01:30 in Cairo (UTC+3, summer).
    // UTC still says the 15th; the sale must be keyed to the 16th, matching
    // the same derivation the nightly sync uses, since both feed the same
    // AI registry and dedupe/group on (date, productId).
    mockSalesRepo.findMany.mockResolvedValue([
      {
        productId: mockProductId,
        date: new Date('2026-07-15T22:30:00.000Z'),
        quantitySold: 4,
      },
    ]);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ learnedLevels: {} }),
    }) as any;

    await service.backfillAiHistory('507f1f77bcf86cd799439011', 90);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.records[0].date).toBe('2026-07-16');
  });

  it('derives training status from the model, not a local transaction count', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      restaurantId: mockRestaurantId,
    });
    mockProductRepo.findMany.mockResolvedValue([
      { _id: mockProductId, title: 'Croissant', category: { name: 'معجنات' } },
    ]);
    // 40 transactions would read as "trained" under the old local heuristic...
    mockSalesRepo.countDocuments.mockResolvedValue(40);
    mockPredictionRepo.findMany.mockResolvedValue([]);

    // ...but the model has only seen 3 distinct days.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        restaurantId: mockRestaurantId.toString(),
        productsTracked: 1,
        usingLearnedLevel: 0,
        items: [
          {
            productId: mockProductId.toString(),
            title: 'Croissant',
            observedDays: 3,
            levelSource: 'owner_estimate',
            learnedLevel: null,
          },
        ],
      }),
    }) as any;

    const result = await service.getLearnedStatus('507f1f77bcf86cd799439011');

    expect(result.degraded).toBe(false);
    expect(result.items[0].status).toBe('learning');
    expect(result.items[0].observedDays).toBe(3);
    expect(result.items[0].levelSource).toBe('owner_estimate');
    expect(result.items[0].progress).toBeCloseTo(3 / 14, 3);
  });

  it('falls back to the local heuristic and flags degraded when the AI is down', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      restaurantId: mockRestaurantId,
    });
    mockProductRepo.findMany.mockResolvedValue([
      { _id: mockProductId, title: 'Croissant', category: { name: 'معجنات' } },
    ]);
    mockSalesRepo.countDocuments.mockResolvedValue(0);
    mockPredictionRepo.findMany.mockResolvedValue([]);
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as any;

    const result = await service.getLearnedStatus('507f1f77bcf86cd799439011');

    expect(result.degraded).toBe(true);
    expect(result.items[0].status).toBe('cold_start');
  });

  it('writes actualOrders and errorAbs back onto a closed week', async () => {
    const p1 = new Types.ObjectId();
    const p2 = new Types.ObjectId();
    const pred1 = new Types.ObjectId();
    const pred2 = new Types.ObjectId();

    mockPredictionRepo.findMany.mockResolvedValue([
      { _id: pred1, productId: p1, predictedOrders: 100 },
      { _id: pred2, productId: p2, predictedOrders: 50 },
    ]);
    mockSalesRepo.findMany.mockResolvedValue([
      { productId: p1, quantitySold: 40 },
      { productId: p1, quantitySold: 50 },
      { productId: p2, quantitySold: 60 },
    ]);
    mockPredictionRepo.bulkWrite = jest
      .fn()
      .mockResolvedValue({ modifiedCount: 2 });

    const result = await service.reconcilePredictionAccuracy(
      mockRestaurantId,
      '2026-07-20',
    );

    expect(result.reconciled).toBe(2);
    const ops = mockPredictionRepo.bulkWrite.mock.calls[0][0];
    const first = ops.find(
      (o: any) => String(o.updateOne.filter._id) === String(pred1),
    );
    expect(first.updateOne.update.$set).toEqual({
      actualOrders: 90,
      errorAbs: 10,
    });
    const second = ops.find(
      (o: any) => String(o.updateOne.filter._id) === String(pred2),
    );
    expect(second.updateOne.update.$set).toEqual({
      actualOrders: 60,
      errorAbs: 10,
    });
    // MAPE = mean(|100-90|/100, |50-60|/50) = mean(0.10, 0.20) = 0.15
    expect(result.mape).toBeCloseTo(0.15, 4);
  });

  it('reconciles against the seven Cairo days of the target week, not a UTC-midnight span', async () => {
    // A July week: Cairo is on DST (UTC+3) for its whole span, so a
    // UTC-midnight window is a genuinely different pair of instants — Cairo
    // midnight Sunday is 21:00Z the previous Saturday. (A winter week under
    // UTC+2 would differ too; July just makes the gap unambiguous and free of
    // any DST transition inside the window.)
    const week = '2026-07-19';

    mockPredictionRepo.findMany.mockResolvedValue([
      {
        _id: new Types.ObjectId(),
        productId: mockProductId,
        predictedOrders: 10,
      },
    ]);
    mockSalesRepo.findMany.mockResolvedValue([]);
    mockPredictionRepo.bulkWrite = jest.fn().mockResolvedValue({});

    await service.reconcilePredictionAccuracy(mockRestaurantId, week);

    const { start } = getBusinessDayRange(week);
    const { end } = getBusinessDayRange(addDaysToDateString(week, 6));
    const filters = mockSalesRepo.findMany.mock.calls[0][0].filters;
    expect(filters.date).toEqual({ $gte: start, $lt: end });

    // The window must cover all seven Cairo days — [Sun 00:00, next Sun 00:00).
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);

    // And it must NOT be the UTC-midnight window. Spelled out explicitly so a
    // regression to `new Date(`${week}T00:00:00.000Z`)` cannot slip through.
    expect(start).not.toEqual(new Date(`${week}T00:00:00.000Z`));
    expect(end).not.toEqual(
      new Date(`${addDaysToDateString(week, 7)}T00:00:00.000Z`),
    );
    expect(start.toISOString()).toBe('2026-07-18T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-25T21:00:00.000Z');
  });

  it('getAccuracy returns one bucket per week, oldest-first, from a single query', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      restaurantId: mockRestaurantId,
    });

    // Derived the same way the service does: Cairo today, back to Cairo Sunday.
    const currentWeekStart = addDaysToDateString(
      getBusinessDateString(),
      -getBusinessDayOfWeek(),
    );
    const w1 = addDaysToDateString(currentWeekStart, -7); // most recently closed
    const w2 = addDaysToDateString(currentWeekStart, -14); // nothing reconciled
    const w3 = addDaysToDateString(currentWeekStart, -21); // oldest

    mockPredictionRepo.findMany.mockResolvedValue([
      { targetWeek: w1, predictedOrders: 100, actualOrders: 90, errorAbs: 10 },
      { targetWeek: w3, predictedOrders: 50, actualOrders: 60, errorAbs: 10 },
      // A zero-prediction row: excluded from the MAPE mean (a percentage error
      // against 0 is undefined) but still counted and still summed.
      { targetWeek: w3, predictedOrders: 0, actualOrders: 7, errorAbs: 7 },
    ]);

    const result = await service.getAccuracy('507f1f77bcf86cd799439011', 3);

    // One round trip, not one per week.
    expect(mockPredictionRepo.findMany).toHaveBeenCalledTimes(1);
    const filters = mockPredictionRepo.findMany.mock.calls[0][0].filters;
    expect(filters.actualOrders).toEqual({ $ne: null });

    const asked: string[] = filters.targetWeek.$in;
    expect(Array.isArray(asked)).toBe(true);
    expect(asked).toHaveLength(3);
    // The still-open current week must never be asked for.
    expect(asked).not.toContain(currentWeekStart);
    const ordered = [...asked].sort();
    expect(ordered).toEqual([w3, w2, w1]);
    for (let i = 1; i < ordered.length; i++) {
      expect(addDaysToDateString(ordered[i - 1], 7)).toBe(ordered[i]);
    }

    // Oldest-first: the dashboard chart plots left-to-right in time.
    expect(result.weeks.map((w: any) => w.targetWeek)).toEqual([w3, w2, w1]);

    // A week with zero reconciled rows stays in the series. Dropping it would
    // silently shift every later point on the chart.
    expect(result.weeks[1]).toEqual({
      targetWeek: w2,
      predictions: 0,
      mape: null,
      totalPredicted: 0,
      totalActual: 0,
    });

    // w3: both rows counted, but MAPE = 10/50 only — the zero-prediction row
    // is out of the mean, not out of the totals.
    expect(result.weeks[0].predictions).toBe(2);
    expect(result.weeks[0].totalPredicted).toBe(50);
    expect(result.weeks[0].totalActual).toBe(67);
    expect(result.weeks[0].mape).toBeCloseTo(0.2, 4);

    // w1 grouped back onto its own key, not merged with w3.
    expect(result.weeks[2].predictions).toBe(1);
    expect(result.weeks[2].mape).toBeCloseTo(0.1, 4);

    expect(result.restaurantId).toBe(mockRestaurantId.toString());
  });

  it('the accuracy cron targets the week that just closed, derived from Cairo', async () => {
    const r1 = new Types.ObjectId();
    mockRestaurantRepo.findMany.mockResolvedValue([{ _id: r1 }]);

    const spy = jest
      .spyOn(service, 'reconcilePredictionAccuracy')
      .mockResolvedValue({
        targetWeek: 'stub',
        reconciled: 0,
        mape: null,
      });

    await service.handleAccuracyReconciliationCron();

    const currentWeekStart = addDaysToDateString(
      getBusinessDateString(),
      -getBusinessDayOfWeek(),
    );
    const closedWeek = addDaysToDateString(currentWeekStart, -7);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(closedWeek);
    // It is the *previous* week, and it is a Sunday. Read at UTC noon so the
    // weekday check cannot straddle a day boundary.
    expect(addDaysToDateString(spy.mock.calls[0][1], 7)).toBe(currentWeekStart);
    const [y, m, d] = closedWeek.split('-').map(Number);
    expect(new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()).toBe(0);
  });

  it('the accuracy cron keeps going when one restaurant throws', async () => {
    const r1 = new Types.ObjectId();
    const r2 = new Types.ObjectId();
    const r3 = new Types.ObjectId();
    mockRestaurantRepo.findMany.mockResolvedValue([
      { _id: r1 },
      { _id: r2 },
      { _id: r3 },
    ]);

    const errorLog = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => {});

    const spy = jest
      .spyOn(service, 'reconcilePredictionAccuracy')
      .mockImplementation(async (restaurantId: any) => {
        if (restaurantId.toString() === r2.toString()) {
          throw new Error('mongo unavailable');
        }
        return { targetWeek: 'stub', reconciled: 0, mape: null };
      });

    // The whole point of the try/catch: one bad restaurant must not abort the
    // sweep, and the cron itself must still resolve.
    await expect(
      service.handleAccuracyReconciliationCron(),
    ).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls.map((c) => String(c[0]))).toEqual([
      String(r1),
      String(r2),
      String(r3),
    ]);
    expect(
      errorLog.mock.calls.some((call) =>
        new RegExp(`Accuracy reconciliation failed for restaurant ${r2}`).test(
          String(call[0]),
        ),
      ),
    ).toBe(true);
  });

  it('processes products concurrently and reports per-product failures', async () => {
    const ids = Array.from({ length: 12 }, () => new Types.ObjectId());
    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      restaurantId: mockRestaurantId,
    });
    mockProductRepo.findMany.mockResolvedValue(ids.map((_id) => ({ _id })));

    let inFlight = 0;
    let peakInFlight = 0;
    jest
      .spyOn(service, 'recalculateProductPrediction')
      .mockImplementation(async (_r: any, productId: any) => {
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((r) => setImmediate(r));
        inFlight--;
        if (productId.toString() === ids[3].toString()) {
          throw new Error('AI exploded');
        }
        return { productId } as any;
      });

    const result = await service.batchRecalculate('507f1f77bcf86cd799439011');

    expect(result.totalProductsPredicted).toBe(11);
    expect(result.failedProductIds).toEqual([ids[3].toString()]);
    // Sequential would peak at 1; unbounded would peak at 12.
    expect(peakInFlight).toBeGreaterThan(1);
    expect(peakInFlight).toBeLessThanOrEqual(5);
  });

  it('sends the owner estimate when there is no sales history', async () => {
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Brand New Item',
      category: { name: 'Pastry' },
      expectedDailySales: 25,
    });
    mockSalesRepo.findMany.mockResolvedValue([]); // no history at all
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

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).avgDailySales).toBe(25);
  });

  it('sends null when there is neither history nor an owner estimate', async () => {
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Unknown Item',
      category: { name: 'Pastry' },
      expectedDailySales: null,
    });
    mockSalesRepo.findMany.mockResolvedValue([]);
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

    // null, NOT 0 — the bridge distinguishes "no estimate" from "sells nothing".
    expect(
      JSON.parse(fetchMock.mock.calls[0][1].body).avgDailySales,
    ).toBeNull();
  });

  it('prefers measured history over the owner estimate once sales exist', async () => {
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Established Item',
      category: { name: 'Pastry' },
      expectedDailySales: 25,
    });
    mockSalesRepo.findMany.mockResolvedValue([{ quantitySold: 140 }]);
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

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).avgDailySales).toBe(10);
  });

  it('does not discard the owner estimate on the naive fallback path when AI is down', async () => {
    // Cold-start product (no sales history) but WITH an owner estimate. If AI
    // is down and the naive fallback collapses a null avgDailySales to 0
    // before checking for the owner's estimate, this would silently zero out
    // predictedOrders — the exact bug this task exists to fix, one layer down.
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Brand New Item',
      category: { name: 'Pastry' },
      expectedDailySales: 25,
    });
    // No 14-day history AND no last-week sales either (genuinely brand new).
    mockSalesRepo.findMany
      .mockResolvedValueOnce([]) // 14-day rolling window
      .mockResolvedValueOnce([]); // last week equivalent period
    mockOfferRepo.findOne.mockResolvedValue(null);
    mockPredictionModel.findOne.mockResolvedValue(null);
    mockPredictionModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    );
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as any;

    const result = await service.recalculateProductPrediction(
      mockRestaurantId,
      mockProductId,
      targetWeek,
    );

    // 25/day * 7 days = 175, not 0.
    expect(result.predictedOrders).toBe(175);
    expect(result.source).toBe(PredictionSourceEnum.FALLBACK_NAIVE);
  });

  it('recalculateSingle surfaces a 401 as a client_error degradation, not a silent HTTP 200', async () => {
    // F1's whole point, on the endpoint that was missed: under a 401 storm
    // POST /predictions/recalculate answered 200 with a fallback_naive row and
    // told the caller nothing. The kind must reach the response body.
    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      restaurantId: mockRestaurantId,
    });
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Croissant',
      category: { name: 'Pastry' },
    });
    mockSalesRepo.findMany.mockResolvedValue([]);
    mockOfferRepo.findOne.mockResolvedValue(null);
    mockPredictionModel.findOne.mockResolvedValue(null);
    mockPredictionModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    );

    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Missing or invalid X-API-Key' }),
    });
    global.fetch = fetchMock as any;

    const result: any = await service.recalculateSingle(
      '507f1f77bcf86cd799439011',
      mockProductId.toString(),
      targetWeek,
    );

    // The row is still returned — but it is labelled.
    expect(result.data.source).toBe(PredictionSourceEnum.FALLBACK_NAIVE);
    expect(result.degraded).toBe(true);
    expect(result.degradedKind).toBe('client_error');
    expect(result.degradedStatus).toBe(401);
    expect(result.degradedReason).toBe('Missing or invalid X-API-Key');
    // A 4xx is never retried: retrying cannot fix a bad API key.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a contract-violating AI 200 as degraded, not as a healthy answer', async () => {
    // The AI answers 200 but omits predictedOrders. The fallback branch runs
    // and the row is persisted with featuresUsed.fallbackReason set — but the
    // degradation callback used to sit inside `if (!aiResult.ok)`, so the wire
    // said `degraded: false` while the stored row said why it had degraded.
    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      restaurantId: mockRestaurantId,
    });
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Croissant',
      category: { name: 'Pastry' },
    });
    mockSalesRepo.findMany.mockResolvedValue([]);
    mockOfferRepo.findOne.mockResolvedValue(null);
    mockPredictionModel.findOne.mockResolvedValue(null);
    mockPredictionModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    );

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      // Well-formed JSON, valid HTTP, and useless: no predictedOrders.
      json: async () => ({
        modelVersionId: 'restomind-bridge/rule_based-v0.1',
        confidence: 'low',
        factors: [],
      }),
    }) as any;

    const result: any = await service.recalculateSingle(
      '507f1f77bcf86cd799439011',
      mockProductId.toString(),
      targetWeek,
    );

    expect(result.data.source).toBe(PredictionSourceEnum.FALLBACK_NAIVE);
    expect(result.degraded).toBe(true);
    // `unavailable`, not `client_error`: our request was fine, the service just
    // could not give a usable answer — which is exactly when a fallback is
    // right. Matches the degradation scanSurplus synthesises for a 200 with no
    // itemsAtRisk.
    expect(result.degradedKind).toBe('unavailable');
    expect(result.degradedReason).toBe('AI response missing predictedOrders');
    // No HTTP status: there was no error status, the 200 was the problem.
    expect(result.degradedStatus).toBeUndefined();
    // The wire now agrees with what was persisted.
    expect(result.data.featuresUsed.fallbackReason).toBe(result.degradedReason);
  });

  it('batchRecalculate also reports a contract-violating AI 200 as degraded', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      restaurantId: mockRestaurantId,
    });
    mockProductRepo.findMany.mockResolvedValue([
      { _id: mockProductId, title: 'Croissant', category: { name: 'Pastry' } },
    ]);
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Croissant',
      category: { name: 'Pastry' },
    });
    mockSalesRepo.findMany.mockResolvedValue([]);
    mockOfferRepo.findOne.mockResolvedValue(null);
    mockPredictionModel.findOne.mockResolvedValue(null);
    mockPredictionModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    );

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ confidence: 'low', factors: [] }),
    }) as any;

    const result: any = await service.batchRecalculate(
      '507f1f77bcf86cd799439011',
      targetWeek,
    );

    expect(result.degraded).toBe(true);
    expect(result.degradedKind).toBe('unavailable');
    expect(result.degradedReason).toBe('AI response missing predictedOrders');
    expect(result.degradedProductIds).toEqual([mockProductId.toString()]);
  });

  it('recalculateSingle reports no degradation on the happy path', async () => {
    // Guards the test above from over-correcting into "always degraded".
    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      restaurantId: mockRestaurantId,
    });
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Croissant',
      category: { name: 'Pastry' },
    });
    mockSalesRepo.findMany.mockResolvedValue([]);
    mockOfferRepo.findOne.mockResolvedValue(null);
    mockPredictionModel.findOne.mockResolvedValue(null);
    mockPredictionModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        modelVersionId: 'restomind-bridge/rule_based-v0.1',
        predictedOrders: 70,
        confidence: 'medium',
        featuresUsed: {},
        factors: [],
        dailyBreakdown: [],
      }),
    }) as any;

    const result: any = await service.recalculateSingle(
      '507f1f77bcf86cd799439011',
      mockProductId.toString(),
      targetWeek,
    );

    expect(result.data.source).toBe(PredictionSourceEnum.AI_MODEL);
    expect(result.degraded).toBe(false);
    expect(result.degradedKind).toBeUndefined();
  });

  it('batchRecalculate reports client_error even when another product only timed out', async () => {
    // A stray timeout on one product must not mask a configuration fault on
    // another: `client_error` is the more actionable diagnosis and wins the
    // firstDegradation slot regardless of which failure landed first.
    const unavailableProduct = new Types.ObjectId();
    const clientErrorProduct = new Types.ObjectId();

    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      restaurantId: mockRestaurantId,
    });
    mockProductRepo.findMany.mockResolvedValue([
      { _id: unavailableProduct, title: 'A', category: { name: 'Pastry' } },
      { _id: clientErrorProduct, title: 'B', category: { name: 'Pastry' } },
    ]);
    mockProductRepo.findOne.mockImplementation(({ filters }: any) =>
      Promise.resolve({
        _id: filters._id,
        title: 'X',
        category: { name: 'Pastry' },
      }),
    );
    mockSalesRepo.findMany.mockResolvedValue([]);
    mockOfferRepo.findOne.mockResolvedValue(null);
    mockPredictionModel.findOne.mockResolvedValue(null);
    mockPredictionModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    );

    // Keyed on the request body, not call order, so the assertion does not
    // depend on how the two concurrent workers interleave. The `unavailable`
    // product is listed FIRST, so it is also the first to fail.
    jest
      .spyOn((service as any).aiClient, 'post')
      .mockImplementation(async (_path: any, body: any) =>
        body.productId === clientErrorProduct.toString()
          ? {
              ok: false,
              kind: 'client_error',
              status: 401,
              message: 'Missing or invalid X-API-Key',
              body: { detail: 'Missing or invalid X-API-Key' },
            }
          : {
              ok: false,
              kind: 'unavailable',
              message: 'timed out after 10000ms',
            },
      );

    const result: any = await service.batchRecalculate(
      '507f1f77bcf86cd799439011',
      targetWeek,
    );

    expect(result.degraded).toBe(true);
    expect(result.degradedKind).toBe('client_error');
    expect(result.degradedStatus).toBe(401);
    expect(result.degradedProductIds.sort()).toEqual(
      [unavailableProduct.toString(), clientErrorProduct.toString()].sort(),
    );
  });

  it('keeps the full 3-attempt retry budget for a single recalculation but caps the batch worker at 2', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      restaurantId: mockRestaurantId,
    });
    mockProductRepo.findOne.mockResolvedValue({
      _id: mockProductId,
      title: 'Croissant',
      category: { name: 'Pastry' },
    });
    mockProductRepo.findMany.mockResolvedValue([
      { _id: mockProductId, title: 'Croissant', category: { name: 'Pastry' } },
    ]);
    mockSalesRepo.findMany.mockResolvedValue([]);
    mockOfferRepo.findOne.mockResolvedValue(null);
    mockPredictionModel.findOne.mockResolvedValue(null);
    mockPredictionModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    );

    const postSpy = jest
      .spyOn((service as any).aiClient, 'post')
      .mockResolvedValue({ ok: false, message: 'AI down' } as any);

    await service.recalculateSingle(
      '507f1f77bcf86cd799439011',
      mockProductId.toString(),
      targetWeek,
    );

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0][2]).toEqual({ retries: 3 });

    postSpy.mockClear();

    await service.batchRecalculate('507f1f77bcf86cd799439011', targetWeek);

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0][2]).toEqual({ retries: 2 });
  });
});
