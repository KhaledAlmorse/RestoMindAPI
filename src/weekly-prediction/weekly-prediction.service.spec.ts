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
});
