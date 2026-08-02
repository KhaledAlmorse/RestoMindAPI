import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { OffersService } from './offers.service';
import { OfferAccessService } from './services/offer-access.service';
import { OfferRulesService } from './services/offer-rules.service';
import { OfferPricingService } from './services/offer-pricing.service';
import {
  OfferRepository,
  ProductRepository,
  RestaurantRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { OfferDiscountTypeEnum, OfferStatusEnum } from 'src/Common/Types';

describe('OffersService', () => {
  let service: OffersService;
  let offerRepo: jest.Mocked<any>;
  let productRepo: jest.Mocked<any>;
  let restaurantRepo: jest.Mocked<any>;
  let userRepo: jest.Mocked<any>;

  const userId = new Types.ObjectId().toString();
  const restaurantId = new Types.ObjectId();
  const productId = new Types.ObjectId();

  beforeEach(async () => {
    offerRepo = {
      findOne: jest.fn(),
      findMany: jest.fn(),
      findManySorted: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    productRepo = { findOne: jest.fn() };
    restaurantRepo = { findOne: jest.fn() };
    userRepo = { findOne: jest.fn() };

    // OfferAccessService/OfferRulesService/OfferPricingService are used as
    // real instances (not mocks), wired to the same mocked repositories —
    // this exercises the real integration while keeping the DB out of it.
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OffersService,
        OfferAccessService,
        OfferRulesService,
        OfferPricingService,
        { provide: OfferRepository, useValue: offerRepo },
        { provide: ProductRepository, useValue: productRepo },
        { provide: RestaurantRepository, useValue: restaurantRepo },
        { provide: UserRepository, useValue: userRepo },
      ],
    }).compile();

    service = module.get<OffersService>(OffersService);

    userRepo.findOne.mockResolvedValue({
      _id: userId,
      restaurantId,
      isDeleted: false,
    });
    restaurantRepo.findOne.mockResolvedValue({
      _id: restaurantId,
      isActive: true,
      isDeleted: false,
    });
    productRepo.findOne.mockResolvedValue({
      _id: productId,
      restaurantId,
      price: 100,
      isDeleted: false,
    });
  });

  const baseCreateDto = () => ({
    productId: productId.toString(),
    discountPercentage: 20,
    startDate: '2999-01-01',
    endDate: '2999-01-05',
    availableQuantity: 10,
  });

  describe('createOffer — overlap detection', () => {
    it('rejects a window that intersects an existing live offer', async () => {
      offerRepo.findOne.mockResolvedValueOnce({
        _id: new Types.ObjectId(),
        startDate: new Date('2999-01-03'),
        endDate: new Date('2999-01-07'),
        status: OfferStatusEnum.ACTIVE,
      });

      await expect(
        service.createOffer(baseCreateDto() as any, userId),
      ).rejects.toThrow(ConflictException);
    });

    it('accepts an adjacent, non-overlapping window', async () => {
      offerRepo.findOne.mockResolvedValueOnce(null); // assertNoOverlap
      offerRepo.create.mockResolvedValue({ _id: new Types.ObjectId() });

      const dto = {
        ...baseCreateDto(),
        startDate: '2999-01-06',
        endDate: '2999-01-09',
      };

      const result = await service.createOffer(dto, userId);
      expect(result.data).toBeDefined();
      expect(offerRepo.create).toHaveBeenCalled();
    });
  });

  describe('createOffer — pricing', () => {
    it('derives offerPrice from a percentage discount', async () => {
      offerRepo.findOne.mockResolvedValueOnce(null);
      offerRepo.create.mockImplementation((doc: any) => ({
        _id: new Types.ObjectId(),
        ...doc,
      }));

      const result = await service.createOffer(baseCreateDto(), userId);
      expect((result.data as any).offerPrice).toBe(80);
      expect((result.data as any).discountPercentage).toBe(20);
    });

    it('derives discountPercentage from a fixed offerPrice', async () => {
      offerRepo.findOne.mockResolvedValueOnce(null);
      offerRepo.create.mockImplementation((doc: any) => ({
        _id: new Types.ObjectId(),
        ...doc,
      }));

      const dto = {
        ...baseCreateDto(),
        discountPercentage: undefined,
        discountType: OfferDiscountTypeEnum.FIXED,
        offerPrice: 75,
      };

      const result = await service.createOffer(dto, userId);
      expect((result.data as any).offerPrice).toBe(75);
      expect((result.data as any).discountPercentage).toBe(25);
      expect((result.data as any).discountType).toBe(
        OfferDiscountTypeEnum.FIXED,
      );
    });

    it('rejects providing both discountPercentage and offerPrice', async () => {
      offerRepo.findOne.mockResolvedValueOnce(null);
      const dto = { ...baseCreateDto(), offerPrice: 75 };

      await expect(service.createOffer(dto as any, userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects providing neither discountPercentage nor offerPrice', async () => {
      offerRepo.findOne.mockResolvedValueOnce(null);
      const dto = { ...baseCreateDto(), discountPercentage: undefined };

      await expect(service.createOffer(dto as any, userId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createOffer — past startDate', () => {
    it('rejects an explicit DRAFT status with a startDate already in the past', async () => {
      offerRepo.findOne.mockResolvedValueOnce(null); // assertNoOverlap

      const dto = {
        ...baseCreateDto(),
        startDate: '2000-01-01',
        endDate: '2999-01-05',
        status: OfferStatusEnum.DRAFT,
      };

      await expect(service.createOffer(dto as any, userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an explicit SCHEDULED status with a startDate already in the past', async () => {
      offerRepo.findOne.mockResolvedValueOnce(null); // assertNoOverlap

      const dto = {
        ...baseCreateDto(),
        startDate: '2000-01-01',
        endDate: '2999-01-05',
        status: OfferStatusEnum.SCHEDULED,
      };

      await expect(service.createOffer(dto as any, userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('still allows a past startDate when it derives an immediately-ACTIVE offer', async () => {
      offerRepo.findOne.mockResolvedValueOnce(null); // assertNoOverlap
      offerRepo.findOne.mockResolvedValueOnce(null); // assertActiveConflict
      offerRepo.create.mockImplementation((doc: any) => ({
        _id: new Types.ObjectId(),
        ...doc,
      }));

      const dto = {
        ...baseCreateDto(),
        startDate: '2000-01-01',
        endDate: '2999-01-05',
      };

      const result = await service.createOffer(dto, userId);
      expect((result.data as any).status).toBe(OfferStatusEnum.ACTIVE);
    });
  });

  describe('updateOffer — status transitions', () => {
    const buildOffer = (overrides: Record<string, any> = {}) => ({
      _id: new Types.ObjectId(),
      productId,
      restaurantId,
      status: OfferStatusEnum.SCHEDULED,
      availableQuantity: 10,
      remainingQuantity: 10,
      startDate: new Date('2999-01-01'),
      endDate: new Date('2999-01-05'),
      discountType: OfferDiscountTypeEnum.PERCENTAGE,
      discountPercentage: 20,
      offerPrice: 80,
      originalPrice: 100,
      ...overrides,
    });

    it('rejects editing an expired offer', async () => {
      offerRepo.findOne.mockResolvedValueOnce(
        buildOffer({ status: OfferStatusEnum.EXPIRED }),
      );

      await expect(
        service.updateOffer(
          new Types.ObjectId().toString(),
          { featured: true } as any,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an illegal transition (active -> scheduled)', async () => {
      offerRepo.findOne.mockResolvedValueOnce(
        buildOffer({ status: OfferStatusEnum.ACTIVE }),
      );

      await expect(
        service.updateOffer(
          new Types.ObjectId().toString(),
          { status: OfferStatusEnum.SCHEDULED } as any,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects changing startDate while the offer is active', async () => {
      offerRepo.findOne.mockResolvedValueOnce(
        buildOffer({ status: OfferStatusEnum.ACTIVE }),
      );

      await expect(
        service.updateOffer(
          new Types.ObjectId().toString(),
          { startDate: '2999-02-01' } as any,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects setting a past startDate while explicitly keeping the offer scheduled', async () => {
      offerRepo.findOne.mockResolvedValueOnce(buildOffer()); // load offer (status: SCHEDULED)
      offerRepo.findOne.mockResolvedValueOnce(null); // assertNoOverlap
      offerRepo.findOne.mockResolvedValueOnce(null); // assertActiveConflict (from derive)

      await expect(
        service.updateOffer(
          new Types.ObjectId().toString(),
          {
            startDate: '2000-01-01',
            endDate: '2999-01-05',
            status: OfferStatusEnum.SCHEDULED,
          } as any,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a legal transition (scheduled -> cancelled)', async () => {
      offerRepo.findOne.mockResolvedValueOnce(buildOffer());
      offerRepo.update.mockResolvedValue(
        buildOffer({ status: OfferStatusEnum.CANCELLED }),
      );

      const result = await service.updateOffer(
        new Types.ObjectId().toString(),
        { status: OfferStatusEnum.CANCELLED },
        userId,
      );
      expect((result.data as any).status).toBe(OfferStatusEnum.CANCELLED);
    });

    it('rejects setting status manually to EXPIRED or SOLD_OUT', async () => {
      offerRepo.findOne.mockResolvedValueOnce(
        buildOffer({ status: OfferStatusEnum.ACTIVE }),
      );

      await expect(
        service.updateOffer(
          new Types.ObjectId().toString(),
          { status: OfferStatusEnum.EXPIRED } as any,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);

      offerRepo.findOne.mockResolvedValueOnce(
        buildOffer({ status: OfferStatusEnum.ACTIVE }),
      );

      await expect(
        service.updateOffer(
          new Types.ObjectId().toString(),
          { status: OfferStatusEnum.SOLD_OUT } as any,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects changing a sold-out offer to active without increasing quantity', async () => {
      offerRepo.findOne.mockResolvedValueOnce(
        buildOffer({
          status: OfferStatusEnum.SOLD_OUT,
          availableQuantity: 10,
          remainingQuantity: 0,
        }),
      );

      await expect(
        service.updateOffer(
          new Types.ObjectId().toString(),
          { status: OfferStatusEnum.ACTIVE } as any,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows changing a sold-out offer to active when quantity is increased', async () => {
      const soldOutOffer = buildOffer({
        status: OfferStatusEnum.SOLD_OUT,
        availableQuantity: 10,
        remainingQuantity: 0,
        startDate: new Date('2000-01-01'),
        endDate: new Date('2999-01-05'),
      });

      offerRepo.findOne
        .mockResolvedValueOnce(soldOutOffer) // load offer
        .mockResolvedValueOnce(null); // assertActiveConflict

      offerRepo.update.mockImplementation(({ body }) =>
        Promise.resolve({ ...soldOutOffer, ...body }),
      );

      const result = await service.updateOffer(
        soldOutOffer._id.toString(),
        { availableQuantity: 15 },
        userId,
      );

      expect(offerRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            availableQuantity: 15,
            remainingQuantity: 5,
            status: OfferStatusEnum.ACTIVE,
          }),
        }),
      );
    });
  });

  describe('cancelOffer', () => {
    it('allows cancelling an active offer before its end date', async () => {
      const offer = {
        _id: new Types.ObjectId(),
        restaurantId,
        status: OfferStatusEnum.ACTIVE,
        endDate: new Date('2999-01-05'),
      };
      offerRepo.findOne
        .mockResolvedValueOnce(offer)
        .mockResolvedValueOnce({ ...offer, status: OfferStatusEnum.CANCELLED });
      offerRepo.update.mockResolvedValue(undefined);

      const result = await service.cancelOffer(offer._id.toString(), userId);
      expect((result.data as any).status).toBe(OfferStatusEnum.CANCELLED);
    });

    it('rejects cancelling an offer whose end date has passed', async () => {
      const offer = {
        _id: new Types.ObjectId(),
        restaurantId,
        status: OfferStatusEnum.ACTIVE,
        endDate: new Date('2000-01-05'),
      };
      offerRepo.findOne.mockResolvedValueOnce(offer);

      await expect(
        service.cancelOffer(offer._id.toString(), userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects cancelling an already-expired offer', async () => {
      const offer = {
        _id: new Types.ObjectId(),
        restaurantId,
        status: OfferStatusEnum.EXPIRED,
        endDate: new Date('2000-01-05'),
      };
      offerRepo.findOne.mockResolvedValueOnce(offer);

      await expect(
        service.cancelOffer(offer._id.toString(), userId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('restockFromCancelledOrderItem', () => {
    it('reactivates a sold-out offer once restocked inside its window with no conflict', async () => {
      const offerId = new Types.ObjectId();
      offerRepo.update.mockResolvedValue(undefined);
      offerRepo.findOne
        .mockResolvedValueOnce({
          _id: offerId,
          productId,
          status: OfferStatusEnum.SOLD_OUT,
          remainingQuantity: 2,
          startDate: new Date(Date.now() - 1000 * 60 * 60),
          endDate: new Date(Date.now() + 1000 * 60 * 60),
          recommendationId: null,
        }) // post-increment read
        .mockResolvedValueOnce(null); // assertActiveConflict — no conflict

      await service.restockFromCancelledOrderItem(offerId, 2, 20);

      expect(offerRepo.update).toHaveBeenCalledWith({
        filters: { _id: offerId },
        body: { status: OfferStatusEnum.ACTIVE },
      });
    });

    it('does not reactivate an expired offer, but still restocks quantity', async () => {
      const offerId = new Types.ObjectId();
      offerRepo.update.mockResolvedValue(undefined);
      offerRepo.findOne.mockResolvedValueOnce({
        _id: offerId,
        productId,
        status: OfferStatusEnum.EXPIRED,
        remainingQuantity: 2,
        startDate: new Date('2000-01-01'),
        endDate: new Date('2000-01-05'),
        recommendationId: null,
      });

      await service.restockFromCancelledOrderItem(offerId, 2, 20);

      expect(offerRepo.update).toHaveBeenCalledWith({
        filters: { _id: offerId },
        body: { $inc: { remainingQuantity: 2 } },
      });
      expect(offerRepo.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          body: { status: OfferStatusEnum.ACTIVE },
        }),
      );
    });
  });
});
