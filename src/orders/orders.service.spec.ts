import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import {
  OrderRepository,
  OrderGroupRepository,
  CartRepository,
  ProductRepository,
  UserRepository,
  RestaurantRepository,
  OfferRepository,
  SalesTransactionRepository,
} from 'src/DB/Repositories';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { OrderStatusEnum } from 'src/Common/Types';

describe('OrdersService', () => {
  let service: OrdersService;
  let orderGroupRepo: jest.Mocked<any>;
  let orderRepo: jest.Mocked<any>;

  beforeEach(async () => {
    orderGroupRepo = {
      create: jest.fn(),
      findOne: jest.fn(),
      findMany: jest.fn(),
      findManyPaginated: jest.fn(),
    };
    orderRepo = {
      create: jest.fn(),
      findOne: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      findManyPaginated: jest.fn(),
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
        { provide: OfferRepository, useValue: {} },
        { provide: SalesTransactionRepository, useValue: {} },
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
    it('should return paginated result with empty data if user has no order groups', async () => {
      const mockUserId = new Types.ObjectId();
      orderGroupRepo.findManyPaginated.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      });

      const result = await service.getMyOrders(mockUserId.toString());
      expect(result).toEqual({
        data: [],
        totalItems: 0,
        totalPages: 1,
        currentPage: 1,
        pageSize: 10,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    it('should return paginated aggregated order groups with correct totals and metadata', async () => {
      const mockUserId = new Types.ObjectId();
      const group1Id = new Types.ObjectId();
      const order1Id = new Types.ObjectId();
      const rest1Id = new Types.ObjectId();

      orderGroupRepo.findManyPaginated.mockResolvedValue({
        items: [
          {
            _id: group1Id,
            userId: mockUserId,
            fullName: 'John Doe',
            phoneNumber: '123456789',
            emailAddress: 'john@example.com',
            deliveryMethod: 'Home Delivery',
            paymentMethod: 'Cash on Delivery',
            totalOriginalPrice: 50,
            totalDiscount: 5,
            finalTotalPrice: 45,
            totalQuantity: 2,
            overallStatus: 'Pending',
            orderIds: [
              {
                _id: order1Id,
                status: 'Pending',
                restaurantId: { _id: rest1Id, name: 'Resto A' },
                items: [{ title: 'Item 1', quantity: 2 }],
                createdAt: new Date(),
              },
            ],
            createdAt: new Date(),
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });

      const result = await service.getMyOrders(mockUserId.toString(), {
        page: 1,
        limit: 10,
        status: OrderStatusEnum.PENDING,
      });
      const data = result.data as any;

      expect(data).toBeDefined();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(data[0].orderGroupId).toBe(group1Id.toString());
      expect(result.totalItems).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.currentPage).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(false);
    });
  });

  describe('getMyOrderDetails', () => {
    it('should throw NotFoundException if order group does not exist', async () => {
      const mockUserId = new Types.ObjectId();
      const mockGroupId = new Types.ObjectId();
      orderGroupRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getMyOrderDetails(
          mockUserId.toString(),
          mockGroupId.toString(),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return details for a specific user order group', async () => {
      const mockUserId = new Types.ObjectId();
      const mockGroupId = new Types.ObjectId();
      const orderId = new Types.ObjectId();
      const restId = new Types.ObjectId();

      orderGroupRepo.findOne.mockResolvedValue({
        _id: mockGroupId,
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
        orderIds: [
          {
            _id: orderId,
            status: 'Pending',
            restaurantId: { _id: restId, name: 'Resto A' },
            items: [{ title: 'Item 1', quantity: 2 }],
            createdAt: new Date(),
          },
        ],
        createdAt: new Date(),
      });

      const result = await service.getMyOrderDetails(
        mockUserId.toString(),
        mockGroupId.toString(),
      );

      expect(result.data).toBeDefined();
      expect(result.data.orderGroupId).toBe(mockGroupId.toString());
    });
  });
});
