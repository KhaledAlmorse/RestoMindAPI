import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  PaymentMethodEnum,
  PaymentPurposeEnum,
  PaymentStatusEnum,
  RefundSettlementModeEnum,
  RefundStatusEnum,
} from 'src/Common/Types';
import { PaymentRepository, RefundRepository } from 'src/DB/Repositories';
import { PaymentType } from 'src/DB/Models/payment.model';
import { RefundType } from 'src/DB/Models/refund.model';
import { verifyTransactionHmac } from './hmac';
import {
  buildCheckoutUrl,
  getEnabledMethods,
  getIntegrationId,
  getPaymobHmacSecret,
} from './paymob.config';
import {
  PaymobBillingData,
  PaymobItem,
  PaymobRawTransaction,
  PaymobService,
  PaymobTimeoutError,
} from './paymob.service';
import {
  PAYMENT_FULFILLERS,
  PaymentFulfillerRegistry,
} from './payment-fulfiller';

export interface CreatePaymentInput {
  purpose: PaymentPurposeEnum;
  userId: Types.ObjectId;
  restaurantId?: Types.ObjectId;
  orderGroupId?: Types.ObjectId;
  amountCents: number;
  method: PaymentMethodEnum;
  billingData: PaymobBillingData;
  items: PaymobItem[];
  notificationUrl: string;
  redirectionUrl: string;
  expirationSeconds: number;
  tier?: string;
}

export type TransactionOutcome = 'applied' | 'duplicate' | 'pending';
export type CallbackOutcome =
  | TransactionOutcome
  | 'rejected'
  | 'unknown_payment';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly refundRepository: RefundRepository,
    private readonly paymobService: PaymobService,
    @Inject(PAYMENT_FULFILLERS)
    private readonly fulfillers: PaymentFulfillerRegistry,
  ) {}

  getEnabledPaymentMethods(): PaymentMethodEnum[] {
    return getEnabledMethods();
  }

  // -------------------------------------------------------------------------
  // Creating a payment
  // -------------------------------------------------------------------------

  async createPayment(
    input: CreatePaymentInput,
  ): Promise<{ payment: PaymentType; checkoutUrl: string }> {
    const specialReference = new Types.ObjectId().toString();

    const payment = await this.paymentRepository.create({
      purpose: input.purpose,
      userId: input.userId,
      restaurantId: input.restaurantId,
      orderGroupId: input.orderGroupId,
      amountCents: input.amountCents,
      currency: 'EGP',
      method: input.method,
      integrationId: getIntegrationId(input.method),
      specialReference,
      status: PaymentStatusEnum.PENDING,
      refundedAmountCents: 0,
      tier: input.tier,
    } as any);

    const intention = await this.paymobService.createIntention({
      amountCents: input.amountCents,
      currency: 'EGP',
      method: input.method,
      specialReference,
      billingData: input.billingData,
      items: input.items,
      notificationUrl: input.notificationUrl,
      redirectionUrl: input.redirectionUrl,
      expirationSeconds: input.expirationSeconds,
    });

    const updated = await this.paymentRepository.update({
      filters: { _id: payment._id },
      body: {
        intentionId: intention.intentionId,
        clientSecret: intention.clientSecret,
        paymobOrderId: intention.paymobOrderId,
      } as any,
    });

    return {
      payment: updated ?? payment,
      checkoutUrl: buildCheckoutUrl(intention.clientSecret),
    };
  }

  // -------------------------------------------------------------------------
  // Settling a payment
  // -------------------------------------------------------------------------

  /**
   * Entry point for the webhook. Verifies authenticity, then hands off to the
   * same outcome logic the reconciliation sweeper uses — so a callback and an
   * inquiry can never disagree about what a transaction means.
   */
  async processCallback(
    obj: Record<string, any>,
    receivedHmac: string,
  ): Promise<CallbackOutcome> {
    if (!verifyTransactionHmac(obj, receivedHmac, getPaymobHmacSecret())) {
      this.logger.error(
        `Rejected callback with invalid HMAC: ${JSON.stringify(obj).slice(0, 800)}`,
      );
      return 'rejected';
    }

    const paymobOrderId = obj?.order?.id;
    const payment = await this.paymentRepository.findOne({
      filters: { paymobOrderId },
    });

    if (!payment) {
      this.logger.warn(`Callback for unknown paymobOrderId ${paymobOrderId}`);
      return 'unknown_payment';
    }

    // A verified HMAC proves the callback is genuine, not that it belongs to
    // THIS payment for THIS amount. Without these two checks, a real callback
    // from a different, cheaper intention could fulfil an expensive order.
    if (Number(obj.amount_cents) !== payment.amountCents) {
      this.logger.error(
        `Amount mismatch on payment ${String(payment._id)}: callback ${obj.amount_cents} vs stored ${payment.amountCents}`,
      );
      return 'rejected';
    }
    if (String(obj.currency) !== payment.currency) {
      this.logger.error(
        `Currency mismatch on payment ${String(payment._id)}: ${obj.currency} vs ${payment.currency}`,
      );
      return 'rejected';
    }

    await this.paymentRepository.update({
      filters: { _id: payment._id },
      body: { hmacVerifiedAt: new Date(), gatewayPayload: obj } as any,
    });

    return this.applyTransactionOutcome(payment, obj as PaymobRawTransaction);
  }

  /**
   * Shared by the webhook and the reconciliation sweeper.
   *
   * Idempotent: the stored paymobTransactionId and the PENDING status are both
   * guards, so a retry is a no-op rather than a second fulfilment.
   */
  async applyTransactionOutcome(
    payment: PaymentType,
    txn: PaymobRawTransaction,
  ): Promise<TransactionOutcome> {
    if (payment.paymobTransactionId === txn.id) return 'duplicate';
    if (payment.status !== PaymentStatusEnum.PENDING) return 'duplicate';

    // Still in flight (wallet OTP outstanding, 3DS in progress). Record
    // nothing — a later callback or sweep resolves it.
    if (txn.pending === true) return 'pending';

    const status = txn.success
      ? PaymentStatusEnum.PAID
      : PaymentStatusEnum.FAILED;

    const updated = await this.paymentRepository.update({
      filters: { _id: payment._id },
      body: { status, paymobTransactionId: txn.id } as any,
    });

    const fulfiller = this.fulfillers[payment.purpose];
    if (!fulfiller) {
      this.logger.error(
        `No fulfiller registered for purpose "${payment.purpose}" — payment ${String(payment._id)} settled with no domain effect`,
      );
      return 'applied';
    }

    const settled = (updated ?? payment) as PaymentType;
    if (status === PaymentStatusEnum.PAID) await fulfiller.onPaid(settled);
    else await fulfiller.onFailed(settled);

    return 'applied';
  }

  // -------------------------------------------------------------------------
  // Refunds
  // -------------------------------------------------------------------------

  /**
   * Atomically reserves refund headroom BEFORE any gateway call.
   *
   * A single-document conditional $inc is atomic in MongoDB on its own, with
   * no session — which matters, because this codebase's `runTransaction` is
   * not actually transactional. Returns false when a concurrent refund has
   * already consumed the headroom.
   */
  async reserveRefund(
    paymentId: Types.ObjectId,
    amountCents: number,
  ): Promise<boolean> {
    const payment = await this.paymentRepository.findOne({
      filters: { _id: paymentId },
    });
    if (!payment) return false;

    const reserved = await this.paymentRepository.findOneAndUpdate({
      filters: {
        _id: paymentId,
        refundedAmountCents: { $lte: payment.amountCents - amountCents },
      },
      updateData: { $inc: { refundedAmountCents: amountCents } },
    });

    return reserved !== null;
  }

  /** Only ever called after a DEFINITE gateway rejection — never on timeout. */
  async releaseRefundReservation(
    paymentId: Types.ObjectId,
    amountCents: number,
  ): Promise<void> {
    await this.paymentRepository.findOneAndUpdate({
      filters: { _id: paymentId },
      updateData: { $inc: { refundedAmountCents: -amountCents } },
    });
  }

  /**
   * Executes an already-reserved, already-approved refund.
   *
   * The ordering is deliberate and must not be rearranged:
   *   reserve -> mark processing -> call gateway -> settle
   *
   * On a definite rejection the reservation is released and the refund is
   * flagged for manual settlement. On a TIMEOUT the reservation is NOT
   * released and nothing is retried — the outcome is unknown, and re-issuing
   * an unknown refund is precisely how you refund twice. The reconciliation
   * cron resolves those by inquiry instead.
   */
  async executeRefund(refundId: Types.ObjectId): Promise<RefundStatusEnum> {
    const refund = await this.refundRepository.findOne({
      filters: { _id: refundId },
    });
    if (!refund) throw new NotFoundException('Refund not found');

    if (refund.settlementMode === RefundSettlementModeEnum.OFFLINE) {
      await this.settleRefund(refund, RefundStatusEnum.MANUAL_REQUIRED, {
        gatewayError: 'Cash on delivery — settle offline with the customer',
      });
      return RefundStatusEnum.MANUAL_REQUIRED;
    }

    const payment = await this.paymentRepository.findOne({
      filters: { _id: refund.paymentId },
    });
    if (!payment?.paymobTransactionId) {
      await this.settleRefund(refund, RefundStatusEnum.MANUAL_REQUIRED, {
        gatewayError: 'No settled gateway transaction to refund against',
      });
      return RefundStatusEnum.MANUAL_REQUIRED;
    }

    await this.refundRepository.update({
      filters: { _id: refund._id },
      body: { status: RefundStatusEnum.PROCESSING } as any,
    });

    const isFullAmount = refund.amountCents === payment.amountCents;

    try {
      const txn = await this.paymobService.refundTransaction(
        payment.paymobTransactionId,
        refund.amountCents,
      );
      await this.settleRefund(refund, RefundStatusEnum.SUCCEEDED, {
        gatewayOperation: 'refund',
        paymobRefundTransactionId: txn.id,
      });
      return RefundStatusEnum.SUCCEEDED;
    } catch (error: any) {
      // Unknown outcome. Leave it PROCESSING for the reconciler; do not
      // release the reservation, do not retry.
      if (error instanceof PaymobTimeoutError) {
        this.logger.error(
          `Refund ${String(refund._id)} timed out — left PROCESSING for reconciliation`,
        );
        return RefundStatusEnum.PROCESSING;
      }

      // ponytail: refund-first with a void fallback, rather than pre-checking
      // settlement state. One round trip in the common case; the fallback only
      // covers same-day full cancellations, which is exactly when void applies.
      if (isFullAmount) {
        try {
          const voided = await this.paymobService.voidTransaction(
            payment.paymobTransactionId,
          );
          await this.settleRefund(refund, RefundStatusEnum.SUCCEEDED, {
            gatewayOperation: 'void',
            paymobRefundTransactionId: voided.id,
          });
          return RefundStatusEnum.SUCCEEDED;
        } catch (voidError: any) {
          if (voidError instanceof PaymobTimeoutError) {
            return RefundStatusEnum.PROCESSING;
          }
        }
      }

      // Definite rejection: give the headroom back and record why, verbatim.
      // Wallet refunds land here when the method does not support them.
      await this.releaseRefundReservation(refund.paymentId, refund.amountCents);
      await this.settleRefund(refund, RefundStatusEnum.MANUAL_REQUIRED, {
        gatewayError: String(error?.message ?? error),
      });
      return RefundStatusEnum.MANUAL_REQUIRED;
    }
  }

  private async settleRefund(
    refund: RefundType,
    status: RefundStatusEnum,
    extra: Record<string, any> = {},
  ): Promise<void> {
    await this.refundRepository.update({
      filters: { _id: refund._id },
      body: { status, completedAt: new Date(), ...extra } as any,
    });
  }
}
