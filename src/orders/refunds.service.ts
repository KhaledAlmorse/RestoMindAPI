import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
  OrderStatusEnum,
  PaymentPurposeEnum,
  PaymentStatusEnum,
  RefundSettlementModeEnum,
  RefundStatusEnum,
  RolesEnum,
} from 'src/Common/Types';
import {
  OrderGroupRepository,
  OrderRepository,
  PaymentRepository,
  RefundRepository,
} from 'src/DB/Repositories';
import { UserType } from 'src/DB/Models';
import { PaymentsService } from 'src/payments/payments.service';
import { CreateRefundDto, ReviewRefundDto } from './dto/refund.dto';
import { OrdersService } from './orders.service';
import { decideRefund, statusAfterRefund } from './refund-policy';

/** Rounds an EGP amount to integer piasters. Never a float. */
function toCents(egp: number): number {
  return Math.round((egp || 0) * 100);
}

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly refundRepository: RefundRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly orderRepository: OrderRepository,
    private readonly orderGroupRepository: OrderGroupRepository,
    private readonly paymentsService: PaymentsService,
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Creates a refund for a whole group, one restaurant's order, or specific
   * line items.
   *
   * A group order spans several restaurants but is paid in ONE Paymob
   * transaction, so a per-restaurant refund is a partial against that
   * transaction.
   */
  async requestRefund(
    groupId: string,
    body: CreateRefundDto,
    currentUser: UserType,
  ) {
    if (!Types.ObjectId.isValid(groupId)) {
      throw new BadRequestException(`Invalid ObjectId: ${groupId}`);
    }

    const group = await this.orderGroupRepository.findOne({
      filters: { _id: new Types.ObjectId(groupId) },
    });
    if (!group) throw new NotFoundException('Order group not found');

    const childOrders =
      (await this.orderRepository.findMany({
        filters: { groupOrderId: group._id },
      })) || [];

    const targetOrders = body.orderId
      ? childOrders.filter((o) => String(o._id) === body.orderId)
      : childOrders;
    if (!targetOrders.length) {
      throw new NotFoundException('No matching order found in this group');
    }

    const isLineItemRefund = Boolean(body.lineItemIndexes?.length);
    if (isLineItemRefund && !body.orderId) {
      throw new BadRequestException(
        'orderId is required when refunding specific line items',
      );
    }

    this.assertRestaurantScope(currentUser, targetOrders);

    if (isLineItemRefund) {
      await this.assertLineItemsNotAlreadyRefunded(
        body.orderId!,
        body.lineItemIndexes!,
      );
    }

    // The most advanced status across the targets decides the policy — a
    // group is only as refundable as its furthest-progressed order.
    const worstStatus = this.mostAdvancedStatus(targetOrders);
    const deliveredAt = this.deliveredAtOf(targetOrders);

    const decision = decideRefund({
      role: currentUser.role,
      isOwner: String(group.userId) === String(currentUser._id),
      orderStatus: worstStatus,
      deliveredAt,
      isLineItemRefund,
    });

    const isCod = group.paymentMethod === 'Cash on Delivery';
    const payment = isCod
      ? null
      : await this.paymentRepository.findOne({
          filters: {
            orderGroupId: group._id,
            purpose: PaymentPurposeEnum.ORDER,
            status: PaymentStatusEnum.PAID,
          },
        });

    if (!isCod && !payment) {
      throw new ConflictException(
        'No settled payment was found for this order group',
      );
    }

    const amountCents = this.resolveAmountCents({
      body,
      group,
      payment,
      targetOrders,
      isLineItemRefund,
    });

    if (amountCents <= 0) {
      throw new BadRequestException('Nothing left to refund on this order');
    }

    // Reserve headroom BEFORE creating the Refund row, so a rejected
    // reservation leaves no orphan record behind.
    if (payment) {
      const reserved = await this.paymentsService.reserveRefund(
        payment._id,
        amountCents,
      );
      if (!reserved) {
        throw new ConflictException(
          'This refund would exceed the amount actually paid',
        );
      }
    }

    const refund = await this.refundRepository.create({
      paymentId: payment?._id,
      orderGroupId: group._id,
      orderId: body.orderId ? new Types.ObjectId(body.orderId) : undefined,
      lineItemIndexes: body.lineItemIndexes,
      amountCents,
      reason: body.reason,
      orderWasDelivered: deliveredAt !== null,
      settlementMode: isCod
        ? RefundSettlementModeEnum.OFFLINE
        : RefundSettlementModeEnum.GATEWAY,
      status:
        decision === 'auto'
          ? RefundStatusEnum.APPROVED
          : RefundStatusEnum.REQUESTED,
      initiatedBy: currentUser._id,
      reviewedBy: decision === 'auto' ? currentUser._id : undefined,
      reviewedAt: decision === 'auto' ? new Date() : undefined,
    } as any);

    if (decision === 'needs_approval') {
      return {
        data: refund,
        message:
          'Your refund request has been submitted and is awaiting review.',
      };
    }

    const status = await this.executeAndApply(refund._id);
    return { data: { ...(refund as any).toObject?.(), status } };
  }

  /** Manager/admin approval of a customer request. */
  async reviewRefund(
    refundId: string,
    body: ReviewRefundDto,
    currentUser: UserType,
  ) {
    if (!Types.ObjectId.isValid(refundId)) {
      throw new BadRequestException(`Invalid ObjectId: ${refundId}`);
    }

    const refund = await this.refundRepository.findOne({
      filters: { _id: new Types.ObjectId(refundId) },
    });
    if (!refund) throw new NotFoundException('Refund not found');

    this.assertRestaurantScope(currentUser, await this.ordersCoveredBy(refund));

    // Manual settlement: the gateway could not move the money, a human did.
    // Only now may the order-side consequences be applied.
    if (body.decision === 'settle') {
      if (refund.status !== RefundStatusEnum.MANUAL_REQUIRED) {
        throw new ConflictException(
          `Only a "manual_required" refund can be settled by hand; this one is "${refund.status}"`,
        );
      }

      // Every path to MANUAL_REQUIRED releases the headroom, so settling has to
      // take it back — otherwise this amount stays refundable a second time
      // through the gateway.
      if (refund.paymentId) {
        const reserved = await this.paymentsService.reserveRefund(
          refund.paymentId,
          refund.amountCents,
        );
        if (!reserved) {
          throw new ConflictException(
            'Settling this refund would exceed the amount actually paid',
          );
        }
      }

      await this.refundRepository.update({
        filters: { _id: refund._id },
        body: {
          status: RefundStatusEnum.SUCCEEDED,
          reviewedBy: currentUser._id,
          reviewedAt: new Date(),
          completedAt: new Date(),
        } as any,
      });

      await this.applyOrderConsequences(refund._id);
      return {
        message: 'Refund settled manually',
        status: RefundStatusEnum.SUCCEEDED,
      };
    }

    if (refund.status !== RefundStatusEnum.REQUESTED) {
      throw new ConflictException(
        `This refund is already "${refund.status}" and cannot be reviewed again`,
      );
    }

    if (body.decision === 'reject') {
      // Release the headroom reserved at request time, or it stays locked
      // against the payment forever.
      if (refund.paymentId) {
        await this.paymentsService.releaseRefundReservation(
          refund.paymentId,
          refund.amountCents,
        );
      }
      await this.refundRepository.update({
        filters: { _id: refund._id },
        body: {
          status: RefundStatusEnum.REJECTED,
          reviewedBy: currentUser._id,
          reviewedAt: new Date(),
          rejectionReason: body.rejectionReason,
        } as any,
      });
      return { message: 'Refund request rejected' };
    }

    await this.refundRepository.update({
      filters: { _id: refund._id },
      body: {
        status: RefundStatusEnum.APPROVED,
        reviewedBy: currentUser._id,
        reviewedAt: new Date(),
      } as any,
    });

    const status = await this.executeAndApply(refund._id);
    return { message: 'Refund approved', status };
  }

  async listRefunds(currentUser: UserType) {
    const filters: Record<string, any> = {};
    // A manager OR staff member sees only refunds against their own
    // restaurant's orders. Staff used to see every refund on the platform.
    if (
      (currentUser.role === RolesEnum.MANAGER ||
        currentUser.role === RolesEnum.STAFF) &&
      currentUser.restaurantId
    ) {
      const orders = await this.orderRepository.findMany({
        filters: { restaurantId: currentUser.restaurantId },
      });
      filters.orderGroupId = {
        $in: (orders || []).map((o) => o.groupOrderId).filter(Boolean),
      };
    }
    const data = await this.refundRepository.findMany({
      filters,
      populationArray: [
        { path: 'orderGroupId' },
        { path: 'orderId' },
        { path: 'initiatedBy', select: '-password' },
        { path: 'reviewedBy', select: '-password' },
      ],
    });
    return { data };
  }

  // -------------------------------------------------------------------------

  /**
   * Runs the gateway call, then applies the order-side consequences only if
   * the money actually moved.
   */
  private async executeAndApply(
    refundId: Types.ObjectId,
  ): Promise<RefundStatusEnum> {
    const status = await this.paymentsService.executeRefund(refundId);

    if (status !== RefundStatusEnum.SUCCEEDED) {
      // PROCESSING (timed out) and MANUAL_REQUIRED both mean the money has
      // NOT provably moved. Cancelling the order here would give the customer
      // their goods back on the books without giving them their money.
      // MANUAL_REQUIRED is resolved later by `decision: 'settle'`.
      return status;
    }

    await this.applyOrderConsequences(refundId);
    return status;
  }

  /**
   * Applies a succeeded refund to the orders behind it.
   *
   * Split out of `executeAndApply` because manual settlement reaches the same
   * end state by a different route. Call this ONLY once the money is provably
   * back with the customer.
   */
  private async applyOrderConsequences(
    refundId: Types.ObjectId,
  ): Promise<void> {
    const refund = await this.refundRepository.findOne({
      filters: { _id: refundId },
    });
    if (!refund) return;

    const childOrders =
      (await this.orderRepository.findMany({
        filters: { groupOrderId: refund.orderGroupId },
      })) || [];

    const targets = refund.orderId
      ? childOrders.filter((o) => String(o._id) === String(refund.orderId))
      : childOrders;

    const isLineItemRefund = Boolean(refund.lineItemIndexes?.length);

    for (const order of targets) {
      // A sibling that is already finished has nothing left to apply. Writing
      // over it would turn a REFUNDED (delivered) order into CANCELLED and
      // falsify the fulfilment record.
      if (
        order.status === OrderStatusEnum.CANCELLED ||
        order.status === OrderStatusEnum.REFUNDED
      ) {
        continue;
      }

      const wasDelivered = order.status === OrderStatusEnum.DELIVERED;
      const next = statusAfterRefund(order.status, isLineItemRefund);
      await this.orderRepository.update({
        filters: { _id: order._id },
        body: { status: next } as any,
      });

      // A partially refunded order keeps the rest of its stock committed; only
      // a whole-order refund returns everything. A DELIVERED order returns
      // nothing at all — the food left the kitchen and was eaten, so restocking
      // the offer would invent inventory the restaurant does not have.
      if (!isLineItemRefund && !wasDelivered) {
        await this.ordersService.restoreStockForOrder(order);
      }
    }

    const refreshed =
      (await this.orderRepository.findMany({
        filters: { groupOrderId: refund.orderGroupId },
      })) || [];
    await this.orderGroupRepository.update({
      filters: { _id: refund.orderGroupId },
      body: {
        overallStatus: this.ordersService.computeGroupStatus(refreshed),
      } as any,
    });

    this.logger.log(
      `Refund ${String(refundId)} applied for ${refund.amountCents} piasters`,
    );
  }

  /** The orders a refund actually covers — one restaurant's, or the group's. */
  private async ordersCoveredBy(refund: any): Promise<any[]> {
    const childOrders =
      (await this.orderRepository.findMany({
        filters: { groupOrderId: refund.orderGroupId },
      })) || [];
    return refund.orderId
      ? childOrders.filter((o) => String(o._id) === String(refund.orderId))
      : childOrders;
  }

  /**
   * A manager or staff member may only act on their own restaurant's orders.
   *
   * Without this, any manager could refund — or approve a refund against — a
   * competitor's order, and a whole-group refund would let one restaurant
   * reverse the other restaurants' sales too.
   */
  private assertRestaurantScope(user: UserType, orders: any[]): void {
    if (user.role !== RolesEnum.MANAGER && user.role !== RolesEnum.STAFF) {
      return;
    }
    if (!user.restaurantId) {
      throw new ForbiddenException(
        'Your account is not linked to a restaurant',
      );
    }
    const allMine = orders.every(
      (o) =>
        String(o.restaurantId?._id ?? o.restaurantId) ===
        String(user.restaurantId),
    );
    if (!allMine) {
      throw new ForbiddenException(
        "You can only handle refunds for your own restaurant's orders",
      );
    }
  }

  /**
   * Stops the same line item being refunded twice.
   *
   * Nothing else does: PARTIALLY_REFUNDED is not a terminal status, so a
   * repeated POST with the same indexes pays out again — consuming headroom
   * that belongs to the other restaurants in the group.
   */
  private async assertLineItemsNotAlreadyRefunded(
    orderId: string,
    indexes: number[],
  ): Promise<void> {
    const live = await this.refundRepository.findMany({
      filters: {
        orderId: new Types.ObjectId(orderId),
        status: {
          $in: [
            RefundStatusEnum.REQUESTED,
            RefundStatusEnum.APPROVED,
            RefundStatusEnum.PROCESSING,
            RefundStatusEnum.SUCCEEDED,
            // A manual_required refund may still be settled by hand, so its
            // items are spoken for until it is rejected.
            RefundStatusEnum.MANUAL_REQUIRED,
          ],
        },
      },
    });

    const taken = new Set((live || []).flatMap((r) => r.lineItemIndexes ?? []));
    const clash = indexes.filter((i) => taken.has(i));
    if (clash.length) {
      throw new ConflictException(
        `Line item(s) ${clash.join(', ')} already have a refund on this order`,
      );
    }
  }

  private resolveAmountCents(input: {
    body: CreateRefundDto;
    group: any;
    payment: any;
    targetOrders: any[];
    isLineItemRefund: boolean;
  }): number {
    const { body, group, payment, targetOrders, isLineItemRefund } = input;

    if (isLineItemRefund) {
      const order = targetOrders[0];
      const items = order.items || [];
      let total = 0;
      for (const index of body.lineItemIndexes!) {
        const item = items[index];
        if (!item) {
          throw new BadRequestException(
            `Line item ${index} does not exist on this order`,
          );
        }
        total += item.lineTotal || 0;
      }
      return toCents(total);
    }

    if (body.orderId) {
      return toCents(targetOrders[0].finalTotalPrice);
    }

    // Whole group: refund whatever of the payment is still unrefunded, so a
    // second whole-group request cannot double-refund an already-partial one.
    if (payment) {
      return payment.amountCents - (payment.refundedAmountCents || 0);
    }
    return toCents(group.finalTotalPrice);
  }

  private mostAdvancedStatus(orders: any[]): OrderStatusEnum {
    const precedence = [
      OrderStatusEnum.AWAITING_PAYMENT,
      OrderStatusEnum.PENDING,
      OrderStatusEnum.CONFIRMED,
      OrderStatusEnum.PREPARING,
      OrderStatusEnum.READY,
      OrderStatusEnum.OUT_FOR_DELIVERY,
      OrderStatusEnum.DELIVERED,
    ];
    let worst = orders[0]?.status as OrderStatusEnum;
    for (const order of orders) {
      if (precedence.indexOf(order.status) > precedence.indexOf(worst)) {
        worst = order.status;
      }
    }
    return worst;
  }

  /**
   * Reads the stamped delivery time only, never `updatedAt` — any later write
   * to the order (a refund, an edit) would silently restart the dispute window
   * and reopen a refund that should have closed.
   *
   * Returns null when no target has one, which the policy turns into an
   * explicit refusal rather than a guess.
   */
  private deliveredAtOf(orders: any[]): Date | null {
    const stamps = orders
      .filter((o) => o.status === OrderStatusEnum.DELIVERED && o.deliveredAt)
      .map((o) => new Date(o.deliveredAt));
    if (!stamps.length) return null;
    // The most recent delivery is the one whose window matters.
    return stamps.sort((a, b) => b.getTime() - a.getTime())[0];
  }
}
