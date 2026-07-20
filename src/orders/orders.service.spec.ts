import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import {
  OrderRepository,
  OrderGroupRepository,
  CartRepository,
  ProductRepository,
  UserRepository,
  RestaurantRepository,
} from 'src/DB/Repositories';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotFoundException } from '@nestjs/common';

describe('OrdersService', () => {
  let service: OrdersService;
  let orderGroupRepo: jest.Mocked<any>;
  let orderRepo: jest.Mocked<any>;

  beforeEach(async () => {
    orderGroupRepo = {
      create: jest.fn(),
      findOne: jest.fn(),
      findMany: jest.fn(),
    };
    orderRepo = {
      create: jest.fn(),
      findOne: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: OrderGroupRepository, useValue: orderGroupRepo },
        { provide: OrderRepository, useValue: orderRepo },
        { provide: CartRepository, useValue: {} },
        { provide: ProductRepository, useValue: {} },
        { provide: UserRepository, useValue: {} },
        { provide: RestaurantRepository, useValue: {} },
        {
          provide: getConnectionToken(),
          useValue: {
            startSession: jest
              .fn()
              .mockRejectedValue(new Error('standalone mongo')),
          },
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  describe('getMyOrders', () => {
    it('should throw NotFoundException if user has no orders', async () => {
      const mockUserId = new Types.ObjectId();
      orderRepo.findMany.mockResolvedValue([]);

      await expect(service.getMyOrders(mockUserId.toString())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return a single aggregated object containing user orders and calculated totals', async () => {
      const mockUserId = new Types.ObjectId();
      const order1Id = new Types.ObjectId();
      const order2Id = new Types.ObjectId();
      const rest1Id = new Types.ObjectId();
      const rest2Id = new Types.ObjectId();

      orderRepo.findMany.mockResolvedValue([
        {
          _id: order1Id,
          userId: mockUserId,
          fullName: 'John Doe',
          phoneNumber: '123456789',
          emailAddress: 'john@example.com',
          totalOriginalPrice: 50,
          totalDiscount: 5,
          finalTotalPrice: 45,
          totalQuantity: 2,
          status: 'Pending',
          restaurantId: { _id: rest1Id, name: 'Resto A' },
          items: [{ title: 'Item 1', quantity: 2 }],
          createdAt: new Date(),
        },
        {
          _id: order2Id,
          userId: mockUserId,
          fullName: 'John Doe',
          phoneNumber: '123456789',
          emailAddress: 'john@example.com',
          totalOriginalPrice: 100,
          totalDiscount: 15,
          finalTotalPrice: 85,
          totalQuantity: 3,
          status: 'Delivered',
          restaurantId: { _id: rest2Id, name: 'Resto B' },
          items: [{ title: 'Item 2', quantity: 3 }],
          createdAt: new Date(),
        },
      ]);

      const result = await service.getMyOrders(mockUserId.toString());

      expect(result.data).toBeDefined();
      expect(result.data.userId).toBe(mockUserId.toString());
      expect(result.data.fullName).toBe('John Doe');
      expect(result.data.totalOriginalPrice).toBe(150);
      expect(result.data.totalDiscount).toBe(20);
      expect(result.data.finalTotalPrice).toBe(130);
      expect(result.data.totalQuantity).toBe(5);
      expect(result.data.orders.length).toBe(2);

      expect(result.data.orders[0].orderId).toBe(order1Id.toString());
      expect(result.data.orders[0].restaurant.name).toBe('Resto A');
      expect(result.data.orders[1].orderId).toBe(order2Id.toString());
      expect(result.data.orders[1].restaurant.name).toBe('Resto B');
    });
  });

  describe('getMyOrderDetails', () => {
    it('should throw NotFoundException if order does not exist', async () => {
      const mockUserId = new Types.ObjectId();
      const mockOrderId = new Types.ObjectId();
      orderRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getMyOrderDetails(
          mockUserId.toString(),
          mockOrderId.toString(),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return details for a specific user order', async () => {
      const mockUserId = new Types.ObjectId();
      const mockOrderId = new Types.ObjectId();
      const restId = new Types.ObjectId();

      orderRepo.findOne.mockResolvedValue({
        _id: mockOrderId,
        userId: mockUserId,
        fullName: 'John Doe',
        phoneNumber: '123456789',
        emailAddress: 'john@example.com',
        deliveryMethod: 'Home Delivery',
        deliveryAddress: { street: 'Main St', city: 'Cairo', country: 'Egypt' },
        paymentMethod: 'Cash on Delivery',
        totalOriginalPrice: 50,
        totalDiscount: 5,
        finalTotalPrice: 45,
        totalQuantity: 2,
        status: 'Pending',
        restaurantId: { _id: restId, name: 'Resto A' },
        items: [{ title: 'Item 1', quantity: 2 }],
        createdAt: new Date(),
      });

      const result = await service.getMyOrderDetails(
        mockUserId.toString(),
        mockOrderId.toString(),
      );

      expect(result.data).toBeDefined();
      expect(result.data.orderId).toBe(mockOrderId.toString());
      expect(result.data.restaurant.name).toBe('Resto A');
      expect(result.data.status).toBe('Pending');
    });
  });
});
