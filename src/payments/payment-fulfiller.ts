import { PaymentPurposeEnum } from 'src/Common/Types';
import { PaymentType } from 'src/DB/Models/payment.model';

/**
 * Implemented by each domain that can be paid for. PaymentsService calls these
 * once a payment's gateway state is settled and verified.
 *
 * Implementations MUST be idempotent: the webhook, the reconciliation sweeper,
 * and a Paymob delivery retry can all deliver the same outcome, and this
 * codebase has no working transactions to lean on.
 */
export interface PaymentFulfiller {
  onPaid(payment: PaymentType): Promise<void>;
  onFailed(payment: PaymentType): Promise<void>;
}

export type PaymentFulfillerRegistry = Partial<
  Record<PaymentPurposeEnum, PaymentFulfiller>
>;

/**
 * Injection token, supplied from the composition root so PaymentsModule never
 * imports OrdersModule or SubscriptionsModule. That inversion is the whole
 * point — without it the module graph is circular, since both of those need
 * PaymentsService to create an intention.
 */
export const PAYMENT_FULFILLERS = 'PAYMENT_FULFILLERS';
