import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentStatusEnum, RefundStatusEnum } from 'src/Common/Types';
import { PaymentRepository, RefundRepository } from 'src/DB/Repositories';
import { PaymobService } from './paymob.service';
import { PaymentsService, pickSettledTransaction } from './payments.service';

/** A payment older than this with no resolution gets actively inquired about. */
const PENDING_GRACE_MS = 15 * 60 * 1000;
/** Stop sweeping eventually, so a dead payment is not polled forever. */
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REFUND_STUCK_MS = 10 * 60 * 1000;

@Injectable()
export class PaymentsReconciliationService {
  private readonly logger = new Logger(PaymentsReconciliationService.name);

  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly refundRepository: RefundRepository,
    private readonly paymobService: PaymobService,
    private readonly paymentsService: PaymentsService,
  ) {}

  /**
   * Resolves payments that never got a callback.
   *
   * Never blind-expires. A missing callback is very often a PAID order —
   * expiring it without asking would cancel something the customer paid for.
   * Wallet payments normally reach us only through this path, because
   * `notification_url` on the Intention applies to card integrations only.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepPendingPayments(): Promise<void> {
    const now = Date.now();
    const stale = await this.paymentRepository.findMany({
      filters: {
        status: PaymentStatusEnum.PENDING,
        createdAt: {
          $lte: new Date(now - PENDING_GRACE_MS),
          $gte: new Date(now - PENDING_MAX_AGE_MS),
        },
      },
    });

    for (const payment of stale ?? []) {
      if (!payment.paymobOrderId) continue;

      try {
        const { transactions } =
          await this.paymobService.getOrderWithTransactions(
            payment.paymobOrderId,
          );

        const settled = pickSettledTransaction(transactions);
        if (settled) {
          // Same code path as a verified callback, so the two can never
          // disagree about what a transaction means.
          await this.paymentsService.applyTransactionOutcome(payment, settled);
          continue;
        }

        // Genuinely never paid. Expire it and let the fulfiller compensate
        // (restore stock, release the order).
        await this.paymentRepository.update({
          filters: { _id: payment._id },
          body: { status: PaymentStatusEnum.EXPIRED } as any,
        });
        this.logger.log(`Expired unpaid payment ${String(payment._id)}`);
      } catch (error: any) {
        // An inquiry failure must never expire anything — try again next tick.
        this.logger.error(
          `Sweep failed for payment ${String(payment._id)}: ${error?.message}`,
        );
      }
    }
  }

  /**
   * Resolves refunds whose gateway call timed out.
   *
   * Resolution is by INQUIRY only, never by re-issuing — re-issuing a refund
   * whose outcome is unknown is how you refund twice.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcileProcessingRefunds(): Promise<void> {
    const stuck = await this.refundRepository.findMany({
      filters: {
        status: RefundStatusEnum.PROCESSING,
        createdAt: { $lte: new Date(Date.now() - REFUND_STUCK_MS) },
      },
    });

    for (const refund of stuck ?? []) {
      try {
        const payment = await this.paymentRepository.findOne({
          filters: { _id: refund.paymentId },
        });
        if (!payment?.paymobOrderId) continue;

        const { transactions } =
          await this.paymobService.getOrderWithTransactions(
            payment.paymobOrderId,
          );

        // A refund appears as its own transaction against the same order.
        const refundTxn = transactions.find(
          (t) => t.is_refunded === true || t.is_voided === true,
        );

        if (refundTxn) {
          await this.refundRepository.update({
            filters: { _id: refund._id },
            body: {
              status: RefundStatusEnum.SUCCEEDED,
              paymobRefundTransactionId: refundTxn.id,
              completedAt: new Date(),
            } as any,
          });
          this.logger.log(
            `Reconciled refund ${String(refund._id)} as succeeded`,
          );
          continue;
        }

        // The gateway has no record, so the timed-out call never landed. Give
        // the headroom back so a human can legitimately re-issue it.
        await this.paymentsService.releaseRefundReservation(
          refund.paymentId,
          refund.amountCents,
        );
        await this.refundRepository.update({
          filters: { _id: refund._id },
          body: {
            status: RefundStatusEnum.MANUAL_REQUIRED,
            gatewayError:
              'Gateway call timed out and no matching refund transaction was found on inquiry',
            completedAt: new Date(),
          } as any,
        });
      } catch (error: any) {
        this.logger.error(
          `Refund reconciliation failed for ${String(refund._id)}: ${error?.message}`,
        );
      }
    }
  }
}
