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
    // The week is [2026-07-27T00:00Z, 2026-08-03T00:00Z).
    expect(filters.startDate).toEqual({
      $lt: new Date('2026-08-03T00:00:00.000Z'),
    });
    expect(filters.endDate).toEqual({
      $gte: new Date('2026-07-27T00:00:00.000Z'),
    });
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
      { productId: mockProductId, date: new Date('2026-06-01T10:00:00Z'), quantitySold: 12 },
      { productId: mockProductId, date: new Date('2026-06-02T10:00:00Z'), quantitySold: 15 },
    ]);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ learnedLevels: { [mockProductId.toString()]: 13.5 } }),
    }) as any;

    const result = await service.backfillAiHistory('507f1f77bcf86cd799439011', 90);

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
      { productId: mockProductId, date: new Date('2026-07-15T22:30:00.000Z'), quantitySold: 4 },
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
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

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
    mockPredictionRepo.bulkWrite = jest.fn().mockResolvedValue({ modifiedCount: 2 });

    const result = await service.reconcilePredictionAccuracy(
      mockRestaurantId,
      '2026-07-20',
    );

    expect(result.reconciled).toBe(2);
    const ops = mockPredictionRepo.bulkWrite.mock.calls[0][0];
    const first = ops.find((o: any) => String(o.updateOne.filter._id) === String(pred1));
    expect(first.updateOne.update.$set).toEqual({
      actualOrders: 90,
      errorAbs: 10,
    });
    const second = ops.find((o: any) => String(o.updateOne.filter._id) === String(pred2));
    expect(second.updateOne.update.$set).toEqual({
      actualOrders: 60,
      errorAbs: 10,
    });
    // MAPE = mean(|100-90|/100, |50-60|/50) = mean(0.10, 0.20) = 0.15
    expect(result.mape).toBeCloseTo(0.15, 4);
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
});
