import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { RefundsService } from './refunds.service';
import {
  OrderRepository,
  OrderGroupRepository,
  CartRepository,
  ProductRepository,
  UserRepository,
  RestaurantRepository,
  OfferRepository,
  SalesTransactionRepository,
  RecipeRepository,
  IngredientRepository,
  InventoryBatchRepository,
  StockTransactionRepository,
} from 'src/DB/Repositories';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrderStatusEnum, RefundStatusEnum, RolesEnum } from 'src/Common/Types';
import { OffersService } from 'src/offers/offers.service';
import { PaymentsService } from 'src/payments/payments.service';
import { SystemSettingsService } from 'src/system-settings/system-settings.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let orderGroupRepo: jest.Mocked<any>;
  let orderRepo: jest.Mocked<any>;
  let recipeRepo: jest.Mocked<any>;
  let ingredientRepo: jest.Mocked<any>;
  let inventoryBatchRepo: jest.Mocked<any>;
  let stockTransactionRepo: jest.Mocked<any>;
  let cartRepo: jest.Mocked<any>;
  let offersServiceMock: jest.Mocked<any>;
  let refundsServiceMock: jest.Mocked<any>;

  beforeEach(async () => {
    orderGroupRepo = {
      create: jest.fn(),
      findOne: jest.fn(),
      findMany: jest.fn(),
      findManyPaginated: jest.fn(),
      update: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    orderRepo = {
      create: jest.fn(),
      findOne: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findManyPaginated: jest.fn(),
      // Claims the one-shot stock-restore flag; a truthy result means this
      // caller won the claim and should proceed to restock.
      findOneAndUpdate: jest.fn().mockResolvedValue({}),
    };
    cartRepo = { findOne: jest.fn(), save: jest.fn() };
    offersServiceMock = { restockFromCancelledOrderItem: jest.fn() };
    refundsServiceMock = {
      // The happy path: the refund executed and the order is now cancelled.
      requestRefund: jest
        .fn()
        .mockResolvedValue({ data: { status: RefundStatusEnum.SUCCEEDED } }),
    };
    recipeRepo = { findOne: jest.fn() };
    ingredientRepo = { findOne: jest.fn().mockResolvedValue({ unit: 'kg' }) };
    inventoryBatchRepo = { findMany: jest.fn(), update: jest.fn() };
    stockTransactionRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: OrderGroupRepository, useValue: orderGroupRepo },
        { provide: OrderRepository, useValue: orderRepo },
        { provide: CartRepository, useValue: cartRepo },
        { provide: ProductRepository, useValue: {} },
        { provide: UserRepository, useValue: {} },
        { provide: RestaurantRepository, useValue: {} },
        { provide: OfferRepository, useValue: {} },
        { provide: SalesTransactionRepository, useValue: {} },
        { provide: RecipeRepository, useValue: recipeRepo },
        { provide: IngredientRepository, useValue: ingredientRepo },
        { provide: InventoryBatchRepository, useValue: inventoryBatchRepo },
        { provide: StockTransactionRepository, useValue: stockTransactionRepo },
        { provide: OffersService, useValue: offersServiceMock },
        { provide: RefundsService, useValue: refundsServiceMock },
        {
          provide: PaymentsService,
          useValue: {
            registerFulfiller: jest.fn(),
            createPayment: jest.fn(),
            expirePendingOrderPayment: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: SystemSettingsService,
          useValue: {
            get: jest.fn().mockResolvedValue({ defaultCommissionRate: 0.05 }),
          },
        },
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

  describe('getAllOrders (customer role)', () => {
    it('should return paginated result with empty data if customer has no order groups', async () => {
      const mockUser = {
        _id: new Types.ObjectId(),
        role: RolesEnum.CUSTOMER,
      } as any;

      orderGroupRepo.findManyPaginated.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      });

      const result = await service.getAllOrders({}, mockUser);
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

    it('should return paginated aggregated order groups for customer', async () => {
      const mockUserId = new Types.ObjectId();
      const mockUser = {
        _id: mockUserId,
        role: RolesEnum.CUSTOMER,
      } as any;

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

      const result = await service.getAllOrders(
        { page: 1, limit: 10, status: OrderStatusEnum.PENDING },
        mockUser,
      );
      const data = result.data as any;

      expect(data).toBeDefined();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(data[0].groupOrderId).toBe(group1Id.toString());
      expect(result.totalItems).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.currentPage).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(false);
    });
  });

  describe('getGroupOrderById', () => {
    it('should throw NotFoundException if order group does not exist', async () => {
      const mockUserId = new Types.ObjectId();
      const mockUser = {
        _id: mockUserId,
        role: RolesEnum.CUSTOMER,
      } as any;
      const mockGroupId = new Types.ObjectId();
      orderGroupRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getGroupOrderById(mockGroupId.toString(), mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return details for a specific user order group', async () => {
      const mockUserId = new Types.ObjectId();
      const mockUser = {
        _id: mockUserId,
        role: RolesEnum.CUSTOMER,
      } as any;
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

      const result = await service.getGroupOrderById(
        mockGroupId.toString(),
        mockUser,
      );

      expect(result.data).toBeDefined();
    });
  });

  describe('getAllOrders (admin role)', () => {
    it('should return grouped order list for admin with populated user info', async () => {
      const mockUserId = new Types.ObjectId();
      const mockAdminUser = {
        _id: new Types.ObjectId(),
        role: RolesEnum.ADMIN,
      } as any;
      const mockGroupId = new Types.ObjectId();
      const order1Id = new Types.ObjectId();
      const order2Id = new Types.ObjectId();
      const rest1Id = new Types.ObjectId();
      const rest2Id = new Types.ObjectId();

      orderGroupRepo.findManyPaginated.mockResolvedValue({
        items: [
          {
            _id: mockGroupId,
            userId: {
              _id: mockUserId,
              firstName: 'user1',
              lastName: 'Info',
              email: 'user1@gmail.com',
            },
            fullName: 'user1 Info',
            phoneNumber: '01098101014',
            emailAddress: 'user1@gmail.com',
            deliveryMethod: 'Home Delivery',
            paymentMethod: 'Cash on Delivery',
            totalOriginalPrice: 115,
            totalDiscount: 16.25,
            finalTotalPrice: 98.75,
            totalQuantity: 3,
            overallStatus: 'Delivered',
            orderIds: [
              {
                _id: order1Id,
                status: 'Delivered',
                restaurantId: { _id: rest1Id, name: 'restaurant_For_Manager1' },
                items: [{ productTitle: 'product2', quantity: 1 }],
                createdAt: new Date(),
              },
              {
                _id: order2Id,
                status: 'Delivered',
                restaurantId: { _id: rest2Id, name: 'restaurant_For_Manager2' },
                items: [
                  { productTitle: 'product4', quantity: 1 },
                  { productTitle: 'product3', quantity: 1 },
                ],
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

      const result = await service.getAllOrders({}, mockAdminUser);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(1);
      const groupDoc = (result.data as any)[0];
      expect(groupDoc.groupOrderId).toBe(mockGroupId.toString());
      expect(groupDoc.orders.length).toBe(2);
      expect(groupDoc.orders[0].restaurant.name).toBe(
        'restaurant_For_Manager1',
      );
      expect(groupDoc.orders[1].restaurant.name).toBe(
        'restaurant_For_Manager2',
      );
      expect(result.totalItems).toBe(1);
    });
  });

  describe('deductInventoryForDeliveredOrder', () => {
    const restaurantId = new Types.ObjectId();
    const otherRestaurantId = new Types.ObjectId();
    const productId = new Types.ObjectId();
    const siblingProductId = new Types.ObjectId();
    const ingredientId = new Types.ObjectId();

    const deliveredOrder = {
      _id: new Types.ObjectId(),
      restaurantId,
      groupOrderId: new Types.ObjectId(),
      items: [{ productId, quantity: 3 }],
    };

    const deduct = () =>
      (service as any).deductInventoryForDeliveredOrder(deliveredOrder);

    beforeEach(() => {
      recipeRepo.findOne.mockResolvedValue({
        ingredients: [
          { ingredientId, quantityPerPortion: 0.5, yieldPercentage: 100 },
        ],
      });
      inventoryBatchRepo.findMany.mockResolvedValue([
        { _id: new Types.ObjectId(), quantityRemaining: 10 },
      ]);
    });

    it('deducts only this order, never its group siblings', async () => {
      // A group order is split one Order per restaurant. Walking the siblings
      // charged another restaurant's recipes against this restaurant's batches,
      // and did it again for every sibling that reached DELIVERED.
      orderRepo.findMany.mockResolvedValue([
        deliveredOrder,
        {
          _id: new Types.ObjectId(),
          restaurantId: otherRestaurantId,
          items: [{ productId: siblingProductId, quantity: 5 }],
        },
      ]);

      await deduct();

      expect(recipeRepo.findOne).toHaveBeenCalledTimes(1);
      expect(recipeRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({ productId }),
        }),
      );
      // 3 portions * 0.5 per portion, this order alone.
      expect(stockTransactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 1.5,
          referenceId: deliveredOrder._id,
        }),
      );
      expect(inventoryBatchRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ body: { quantityRemaining: 8.5 } }),
      );
    });

    it('is a no-op when this order was already consumed', async () => {
      // The idempotency key only works because StockTransaction persists
      // referenceId — an unmapped field would be dropped on write and this
      // lookup would never match, letting a re-delivery deplete stock twice.
      stockTransactionRepo.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
      });

      await deduct();

      expect(stockTransactionRepo.create).not.toHaveBeenCalled();
      expect(inventoryBatchRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('restoreStockForOrder', () => {
    it('restocks every line item exactly once', async () => {
      await service.restoreStockForOrder({
        _id: new Types.ObjectId(),
        items: [
          { offerId: 'o1', quantity: 2, lineTotal: 100 },
          { offerId: 'o2', quantity: 1, lineTotal: 50 },
        ],
      } as any);

      expect(
        offersServiceMock.restockFromCancelledOrderItem,
      ).toHaveBeenCalledTimes(2);
      expect(
        offersServiceMock.restockFromCancelledOrderItem,
      ).toHaveBeenCalledWith('o1', 2, 100);
      expect(
        offersServiceMock.restockFromCancelledOrderItem,
      ).toHaveBeenCalledWith('o2', 1, 50);
    });

    it('skips items with no offerId rather than throwing', async () => {
      await service.restoreStockForOrder({
        _id: new Types.ObjectId(),
        items: [{ quantity: 1 }],
      } as any);
      expect(
        offersServiceMock.restockFromCancelledOrderItem,
      ).not.toHaveBeenCalled();
    });

    it('restocks only once when two paths fire against the same order', async () => {
      // Refund-then-cancel, or webhook-then-sweeper. The second caller loses
      // the conditional claim on stockRestoredAt and must not restock again.
      orderRepo.findOneAndUpdate
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce(null);
      const order = {
        _id: new Types.ObjectId(),
        items: [{ offerId: 'o1', quantity: 2, lineTotal: 100 }],
      } as any;

      await service.restoreStockForOrder(order);
      await service.restoreStockForOrder(order);

      expect(
        offersServiceMock.restockFromCancelledOrderItem,
      ).toHaveBeenCalledTimes(1);
    });

    it('continues restocking after one item fails', async () => {
      // A single bad offer must not strand the rest of the customer's stock.
      offersServiceMock.restockFromCancelledOrderItem
        .mockRejectedValueOnce(new Error('offer gone'))
        .mockResolvedValueOnce(undefined);

      await service.restoreStockForOrder({
        _id: new Types.ObjectId(),
        items: [
          { offerId: 'o1', quantity: 1, lineTotal: 10 },
          { offerId: 'o2', quantity: 1, lineTotal: 10 },
        ],
      } as any);

      expect(
        offersServiceMock.restockFromCancelledOrderItem,
      ).toHaveBeenCalledTimes(2);
    });
  });

  describe('payment fulfilment', () => {
    const groupId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const payment = { _id: 'pay1', orderGroupId: groupId } as any;

    it('promotes an awaiting-payment group to pending and clears the cart', async () => {
      orderGroupRepo.findOne.mockResolvedValue({
        _id: groupId,
        userId,
        overallStatus: OrderStatusEnum.AWAITING_PAYMENT,
      });
      const cart = { items: [{ offerId: 'o1' }] };
      cartRepo.findOne.mockResolvedValue(cart);

      await service.onPaid(payment);

      expect(orderRepo.updateMany).toHaveBeenCalledWith(
        { groupOrderId: groupId, status: OrderStatusEnum.AWAITING_PAYMENT },
        { status: OrderStatusEnum.PENDING },
      );
      expect(orderGroupRepo.update).toHaveBeenCalledWith({
        filters: { _id: groupId },
        body: { overallStatus: OrderStatusEnum.PENDING },
      });
      // The cart is cleared here, not at creation.
      expect(cart.items).toEqual([]);
      expect(cartRepo.save).toHaveBeenCalled();
    });

    it('ignores a repeated onPaid for a group already promoted', async () => {
      orderGroupRepo.findOne.mockResolvedValue({
        _id: groupId,
        userId,
        overallStatus: OrderStatusEnum.PENDING,
      });

      await service.onPaid(payment);

      expect(orderRepo.updateMany).not.toHaveBeenCalled();
      expect(cartRepo.save).not.toHaveBeenCalled();
    });

    it('restores stock and parks the group when payment fails', async () => {
      orderGroupRepo.findOneAndUpdate.mockResolvedValue({ _id: groupId });
      orderRepo.findMany.mockResolvedValue([
        {
          _id: 'child1',
          items: [{ offerId: 'o1', quantity: 2, lineTotal: 40 }],
        },
      ]);

      await service.onFailed(payment);

      expect(
        offersServiceMock.restockFromCancelledOrderItem,
      ).toHaveBeenCalledWith('o1', 2, 40);
      expect(orderRepo.updateMany).toHaveBeenCalledWith(
        { groupOrderId: groupId, status: OrderStatusEnum.AWAITING_PAYMENT },
        { status: OrderStatusEnum.PAYMENT_FAILED },
      );
    });

    it('claims the transition conditionally, so it cannot double-restore', async () => {
      // The webhook and the reconciliation sweeper can both call onFailed for
      // the same payment. The conditional claim is what stops the second one
      // returning stock that was already returned.
      orderGroupRepo.findOneAndUpdate.mockResolvedValue(null);

      await service.onFailed(payment);

      expect(
        offersServiceMock.restockFromCancelledOrderItem,
      ).not.toHaveBeenCalled();
      expect(orderRepo.updateMany).not.toHaveBeenCalled();
      expect(orderGroupRepo.findOneAndUpdate).toHaveBeenCalledWith({
        filters: {
          _id: groupId,
          overallStatus: OrderStatusEnum.AWAITING_PAYMENT,
        },
        updateData: {
          $set: { overallStatus: OrderStatusEnum.PAYMENT_FAILED },
        },
      });
    });

    it('ignores a payment with no order group', async () => {
      await service.onPaid({ _id: 'p' } as any);
      await service.onFailed({ _id: 'p' } as any);
      expect(orderGroupRepo.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('cancelOrderGroup', () => {
    const userId = new Types.ObjectId();
    const currentUser = { _id: userId, role: RolesEnum.CUSTOMER } as any;

    function makeGroup(overallStatus: OrderStatusEnum) {
      const groupId = new Types.ObjectId();
      const orderId = new Types.ObjectId();
      const restaurantId = new Types.ObjectId();
      const childOrder = {
        _id: orderId,
        status: overallStatus,
        restaurantId: { _id: restaurantId, name: 'Resto' },
        items: [],
        createdAt: new Date(),
      };
      const group = {
        _id: groupId,
        userId,
        overallStatus,
        orderIds: [childOrder],
        createdAt: new Date(),
      };
      return { groupId, group, childOrder };
    }

    it('cancels directly and skips the refund flow when the group is still AWAITING_PAYMENT', async () => {
      const { groupId, group, childOrder } = makeGroup(
        OrderStatusEnum.AWAITING_PAYMENT,
      );
      orderGroupRepo.findOne.mockResolvedValue(group);

      await service.cancelOrderGroup(groupId.toString(), currentUser);

      expect(refundsServiceMock.requestRefund).not.toHaveBeenCalled();
      expect(orderRepo.update).toHaveBeenCalledWith({
        filters: { _id: childOrder._id },
        body: { status: OrderStatusEnum.CANCELLED },
      });
      expect(orderGroupRepo.update).toHaveBeenCalledWith({
        filters: { _id: group._id },
        body: { overallStatus: OrderStatusEnum.CANCELLED },
      });
    });

    it('routes through requestRefund and does not cancel directly when the group is PENDING', async () => {
      const { groupId, group } = makeGroup(OrderStatusEnum.PENDING);
      orderGroupRepo.findOne.mockResolvedValue(group);

      await service.cancelOrderGroup(groupId.toString(), currentUser);

      expect(refundsServiceMock.requestRefund).toHaveBeenCalledTimes(1);
      expect(refundsServiceMock.requestRefund).toHaveBeenCalledWith(
        groupId.toString(),
        { reason: 'Order cancelled by customer' },
        currentUser,
      );
      expect(orderRepo.update).not.toHaveBeenCalled();
    });

    it('cancels directly and skips the refund flow when the group is PAYMENT_FAILED', async () => {
      // Nothing was ever collected, and the refund policy treats
      // PAYMENT_FAILED as terminal — routing it into requestRefund would 403.
      const { groupId, group, childOrder } = makeGroup(
        OrderStatusEnum.PAYMENT_FAILED,
      );
      orderGroupRepo.findOne.mockResolvedValue(group);

      await service.cancelOrderGroup(groupId.toString(), currentUser);

      expect(refundsServiceMock.requestRefund).not.toHaveBeenCalled();
      expect(orderRepo.update).toHaveBeenCalledWith({
        filters: { _id: childOrder._id },
        body: { status: OrderStatusEnum.CANCELLED },
      });
      expect(orderGroupRepo.update).toHaveBeenCalledWith({
        filters: { _id: group._id },
        body: { overallStatus: OrderStatusEnum.CANCELLED },
      });
    });

    it('throws Conflict when the refund did not actually succeed', async () => {
      const { groupId, group } = makeGroup(OrderStatusEnum.PENDING);
      orderGroupRepo.findOne.mockResolvedValue(group);
      refundsServiceMock.requestRefund.mockResolvedValueOnce({
        data: { status: RefundStatusEnum.REQUESTED },
        message:
          'Your refund request has been submitted and is awaiting review.',
      });

      await expect(
        service.cancelOrderGroup(groupId.toString(), currentUser),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateOrderStatus to CANCELLED', () => {
    const currentUser = {
      _id: new Types.ObjectId(),
      role: RolesEnum.ADMIN,
    } as any;

    it('routes through requestRefund with a string orderId when the group has moved past AWAITING_PAYMENT', async () => {
      const orderId = new Types.ObjectId();
      const groupOrderId = new Types.ObjectId();
      const order = {
        _id: orderId,
        status: OrderStatusEnum.PENDING,
        groupOrderId,
        restaurantId: new Types.ObjectId(),
        items: [],
      };
      orderRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, status: OrderStatusEnum.CANCELLED });

      await service.updateOrderStatus(
        orderId.toString(),
        OrderStatusEnum.CANCELLED,
        currentUser,
      );

      expect(refundsServiceMock.requestRefund).toHaveBeenCalledTimes(1);
      const [calledGroupId, body, calledUser] =
        refundsServiceMock.requestRefund.mock.calls[0];
      expect(calledGroupId).toBe(groupOrderId.toString());
      expect(body.orderId).toBe(orderId.toString());
      expect(typeof body.orderId).toBe('string');
      expect(body.reason).toBe('Order cancelled by restaurant');
      expect(calledUser).toBe(currentUser);
    });

    it('cancels directly and restores stock when the order is still AWAITING_PAYMENT', async () => {
      const orderId = new Types.ObjectId();
      const groupOrderId = new Types.ObjectId();
      const order = {
        _id: orderId,
        status: OrderStatusEnum.AWAITING_PAYMENT,
        groupOrderId,
        restaurantId: new Types.ObjectId(),
        items: [],
      };
      orderRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, status: OrderStatusEnum.CANCELLED });
      orderRepo.findMany.mockResolvedValue([
        { ...order, status: OrderStatusEnum.CANCELLED },
      ]);
      const restoreStockSpy = jest.spyOn(service, 'restoreStockForOrder');

      await service.updateOrderStatus(
        orderId.toString(),
        OrderStatusEnum.CANCELLED,
        currentUser,
      );

      expect(refundsServiceMock.requestRefund).not.toHaveBeenCalled();
      expect(orderRepo.update).toHaveBeenCalledWith({
        filters: { _id: orderId },
        body: { status: OrderStatusEnum.CANCELLED },
      });
      expect(restoreStockSpy).toHaveBeenCalledWith(
        expect.objectContaining({ _id: orderId }),
      );
    });

    it('cancels directly and restores stock when the order is PAYMENT_FAILED', async () => {
      const orderId = new Types.ObjectId();
      const groupOrderId = new Types.ObjectId();
      const order = {
        _id: orderId,
        status: OrderStatusEnum.PAYMENT_FAILED,
        groupOrderId,
        restaurantId: new Types.ObjectId(),
        items: [],
      };
      orderRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, status: OrderStatusEnum.CANCELLED });
      orderRepo.findMany.mockResolvedValue([
        { ...order, status: OrderStatusEnum.CANCELLED },
      ]);
      const restoreStockSpy = jest.spyOn(service, 'restoreStockForOrder');

      await service.updateOrderStatus(
        orderId.toString(),
        OrderStatusEnum.CANCELLED,
        currentUser,
      );

      expect(refundsServiceMock.requestRefund).not.toHaveBeenCalled();
      expect(orderRepo.update).toHaveBeenCalledWith({
        filters: { _id: orderId },
        body: { status: OrderStatusEnum.CANCELLED },
      });
      expect(restoreStockSpy).toHaveBeenCalledWith(
        expect.objectContaining({ _id: orderId }),
      );
    });

    it('throws Conflict when the refund did not actually succeed', async () => {
      const orderId = new Types.ObjectId();
      const order = {
        _id: orderId,
        status: OrderStatusEnum.PENDING,
        groupOrderId: new Types.ObjectId(),
        restaurantId: new Types.ObjectId(),
        items: [],
      };
      orderRepo.findOne.mockResolvedValueOnce(order);
      refundsServiceMock.requestRefund.mockResolvedValueOnce({
        data: { status: RefundStatusEnum.MANUAL_REQUIRED },
      });

      await expect(
        service.updateOrderStatus(
          orderId.toString(),
          OrderStatusEnum.CANCELLED,
          currentUser,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('cancels directly when the order has no groupOrderId at all', async () => {
      const orderId = new Types.ObjectId();
      const order = {
        _id: orderId,
        status: OrderStatusEnum.PENDING,
        restaurantId: new Types.ObjectId(),
        items: [],
      };
      orderRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, status: OrderStatusEnum.CANCELLED });
      const restoreStockSpy = jest.spyOn(service, 'restoreStockForOrder');

      await service.updateOrderStatus(
        orderId.toString(),
        OrderStatusEnum.CANCELLED,
        currentUser,
      );

      expect(refundsServiceMock.requestRefund).not.toHaveBeenCalled();
      expect(orderRepo.update).toHaveBeenCalledWith({
        filters: { _id: orderId },
        body: { status: OrderStatusEnum.CANCELLED },
      });
      expect(restoreStockSpy).toHaveBeenCalledWith(
        expect.objectContaining({ _id: orderId }),
      );
    });
  });
});
