import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CartService } from './cart.service';
import {
  CartRepository,
  OfferRepository,
  OrderRepository,
} from 'src/DB/Repositories';
import { OfferStatusEnum, OrderStatusEnum } from 'src/Common/Types';

describe('CartService', () => {
  let service: CartService;
  let cartRepo: jest.Mocked<any>;
  let offerRepo: jest.Mocked<any>;
  let orderRepo: jest.Mocked<any>;

  const userId = new Types.ObjectId().toString();
  const offerId = new Types.ObjectId().toString();
  const restaurantId = new Types.ObjectId();
  const now = new Date();

  const buildOffer = (overrides = {}) => ({
    _id: new Types.ObjectId(offerId),
    productId: new Types.ObjectId(),
    restaurantId,
    originalPrice: 100,
    offerPrice: 80,
    discountPercentage: 20,
    availableQuantity: 10,
    remainingQuantity: 10,
    maxPerCustomer: 5,
    startDate: new Date(now.getTime() - 86400000),
    endDate: new Date(now.getTime() + 86400000),
    status: OfferStatusEnum.ACTIVE,
    isDeleted: false,
    ...overrides,
  });

  const buildCart = (items: { offerId: string; quantity: number }[] = []) => ({
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(userId),
    items: items.map((i) => ({
      offerId: new Types.ObjectId(i.offerId),
      quantity: i.quantity,
    })),
  });

  beforeEach(async () => {
    cartRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    offerRepo = {
      findOne: jest.fn(),
    };
    orderRepo = {
      findMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: CartRepository, useValue: cartRepo },
        { provide: OfferRepository, useValue: offerRepo },
        { provide: OrderRepository, useValue: orderRepo },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
  });

  describe('updateQuantity', () => {
    it('rejects when cart does not exist', async () => {
      cartRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateQuantity(userId, offerId, 3),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when item is not found in cart', async () => {
      cartRepo.findOne.mockResolvedValue(buildCart([]));

      await expect(
        service.updateQuantity(userId, offerId, 3),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows increasing quantity (diff > 0) within limits', async () => {
      const cart = buildCart([{ offerId, quantity: 3 }]);
      cartRepo.findOne.mockResolvedValue(cart);

      const offer = buildOffer({ remainingQuantity: 10, maxPerCustomer: 10 });
      offerRepo.findOne.mockResolvedValue(offer);
      orderRepo.findMany.mockResolvedValue([]);

      const result = await service.updateQuantity(userId, offerId, 6);
      expect(cart.items[0].quantity).toBe(6);
      expect(cartRepo.save).toHaveBeenCalledWith(cart);
      expect(result.data).toBeDefined();
    });

    it('rejects increasing quantity when stock is insufficient (diff > 0)', async () => {
      const cart = buildCart([{ offerId, quantity: 3 }]);
      cartRepo.findOne.mockResolvedValue(cart);

      const offer = buildOffer({ remainingQuantity: 2, maxPerCustomer: 10 });
      offerRepo.findOne.mockResolvedValue(offer);
      orderRepo.findMany.mockResolvedValue([]);

      await expect(
        service.updateQuantity(userId, offerId, 6),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects increasing quantity when maxPerCustomer exceeded (diff > 0)', async () => {
      const cart = buildCart([{ offerId, quantity: 3 }]);
      cartRepo.findOne.mockResolvedValue(cart);

      const offer = buildOffer({ remainingQuantity: 10, maxPerCustomer: 5 });
      offerRepo.findOne.mockResolvedValue(offer);
      orderRepo.findMany.mockResolvedValue([]);

      await expect(
        service.updateQuantity(userId, offerId, 6),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows decreasing quantity (diff < 0) without validation', async () => {
      const cart = buildCart([{ offerId, quantity: 5 }]);
      cartRepo.findOne.mockResolvedValue(cart);

      const result = await service.updateQuantity(userId, offerId, 3);
      expect(cart.items[0].quantity).toBe(3);
      expect(cartRepo.save).toHaveBeenCalledWith(cart);
      expect(offerRepo.findOne).not.toHaveBeenCalled();
      expect(orderRepo.findMany).not.toHaveBeenCalled();
      expect(result.data).toBeDefined();
    });

    it('allows no-op update (diff === 0) without triggering validation', async () => {
      const cart = buildCart([{ offerId, quantity: 5 }]);
      cartRepo.findOne.mockResolvedValue(cart);

      const result = await service.updateQuantity(userId, offerId, 5);
      expect(cart.items[0].quantity).toBe(5);
      expect(cartRepo.save).toHaveBeenCalledWith(cart);
      expect(offerRepo.findOne).not.toHaveBeenCalled();
      expect(orderRepo.findMany).not.toHaveBeenCalled();
      expect(result.data).toBeDefined();
    });
  });
});
