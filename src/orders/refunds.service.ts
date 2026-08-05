import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
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
    // A manager sees only refunds against their own restaurant's orders.
    if (currentUser.role === RolesEnum.MANAGER && currentUser.restaurantId) {
      const orders = await this.orderRepository.findMany({
        filters: { restaurantId: currentUser.restaurantId },
      });
      filters.orderGroupId = {
        $in: (orders || []).map((o) => o.groupOrderId).filter(Boolean),
      };
    }
    const data = await this.refundRepository.findMany({ filters });
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
      return status;
    }

    const refund = await this.refundRepository.findOne({
      filters: { _id: refundId },
    });
    if (!refund) return status;

    const childOrders =
      (await this.orderRepository.findMany({
        filters: { groupOrderId: refund.orderGroupId },
      })) || [];

    const targets = refund.orderId
      ? childOrders.filter((o) => String(o._id) === String(refund.orderId))
      : childOrders;

    const isLineItemRefund = Boolean(refund.lineItemIndexes?.length);

    for (const order of targets) {
      const next = statusAfterRefund(
        order.status as OrderStatusEnum,
        isLineItemRefund,
      );
      await this.orderRepository.update({
        filters: { _id: order._id },
        body: { status: next } as any,
      });

      // A partially refunded order keeps the rest of its stock committed;
      // only a whole-order refund returns everything.
      if (!isLineItemRefund) {
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
      `Refund ${String(refundId)} succeeded for ${refund.amountCents} piasters`,
    );
    return status;
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
      if (
        precedence.indexOf(order.status) > precedence.indexOf(worst as any)
      ) {
        worst = order.status;
      }
    }
    return worst;
  }

  private deliveredAtOf(orders: any[]): Date | null {
    const delivered = orders.filter(
      (o) => o.status === OrderStatusEnum.DELIVERED,
    );
    if (!delivered.length) return null;
    // The most recent delivery is the one whose window matters.
    return delivered
      .map((o) => new Date(o.updatedAt || o.createdAt))
      .sort((a, b) => b.getTime() - a.getTime())[0];
  }
}
