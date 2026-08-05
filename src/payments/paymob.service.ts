import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PaymentMethodEnum } from 'src/Common/Types';
import {
  PAYMOB_BASE_URL,
  getIntegrationId,
  getPaymobApiKey,
  getPaymobSecretKey,
} from './paymob.config';

/** Distinguishes "we don't know the outcome" from "the gateway said no". */
export class PaymobTimeoutError extends ServiceUnavailableException {
  constructor(operation: string) {
    super(`Paymob request timed out: ${operation}`);
  }
}

export interface PaymobBillingData {
  first_name: string;
  last_name: string;
  phone_number: string;
  email: string;
  street: string;
  city: string;
  country: string;
}

export interface PaymobItem {
  name: string;
  amount: number;
  quantity: number;
  description?: string;
}

export interface CreateIntentionInput {
  amountCents: number;
  currency: string;
  method: PaymentMethodEnum;
  specialReference: string;
  billingData: PaymobBillingData;
  items: PaymobItem[];
  notificationUrl: string;
  redirectionUrl: string;
  /** Intention lifetime in seconds. */
  expirationSeconds: number;
}

export interface CreateIntentionResult {
  intentionId: string;
  clientSecret: string;
  paymobOrderId: number;
}

/** The transaction shape Paymob returns — identical in callbacks and inquiry. */
export interface PaymobRawTransaction {
  id: number;
  success: boolean;
  pending: boolean;
  is_voided: boolean;
  is_refunded: boolean;
  amount_cents: number;
  currency: string;
  order: { id: number };
  [key: string]: any;
}

/**
 * Knows HTTP and Paymob auth. Knows nothing about orders, subscriptions, or
 * our database — that separation is what makes the gateway swappable and the
 * domain services testable without a network.
 */
@Injectable()
export class PaymobService {
  private readonly logger = new Logger(PaymobService.name);

  /**
   * Every Paymob call funnels through here, so timeouts, non-2xx handling and
   * log redaction exist in exactly one place.
   */
  private async request<T>(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<T> {
    const { timeoutMs = 15_000, ...rest } = init;
    const method = (init.method ?? 'GET').toUpperCase();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${PAYMOB_BASE_URL}${path}`, {
        ...rest,
        signal: controller.signal,
      });
      const text = await response.text();

      if (!response.ok) {
        // The body can contain merchant data but never our keys — the keys
        // only travel in headers, which are not echoed back.
        this.logger.error(
          `Paymob ${method} ${path} -> ${response.status}: ${text.slice(0, 500)}`,
        );
        throw new ServiceUnavailableException(
          `Paymob request failed with status ${response.status}`,
        );
      }

      return text ? (JSON.parse(text) as T) : ({} as T);
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        // Deliberately its own error type. A timeout means the outcome is
        // UNKNOWN — the refund path must never treat it as a failure and
        // retry, or it refunds twice.
        throw new PaymobTimeoutError(`${method} ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Note the literal word `Token` — Paymob rejects `Bearer`. */
  private secretHeaders(): Record<string, string> {
    return {
      Authorization: `Token ${getPaymobSecretKey()}`,
      'Content-Type': 'application/json',
    };
  }

  async createIntention(
    input: CreateIntentionInput,
  ): Promise<CreateIntentionResult> {
    const data = await this.request<{
      id: string;
      client_secret: string;
      intention_order_id: number;
    }>('/v1/intention/', {
      method: 'POST',
      headers: this.secretHeaders(),
      body: JSON.stringify({
        amount: input.amountCents,
        currency: input.currency,
        payment_methods: [getIntegrationId(input.method)],
        items: input.items,
        billing_data: input.billingData,
        special_reference: input.specialReference,
        expiration: input.expirationSeconds,
        notification_url: input.notificationUrl,
        redirection_url: input.redirectionUrl,
      }),
    });

    return {
      intentionId: String(data.id),
      clientSecret: data.client_secret,
      paymobOrderId: data.intention_order_id,
    };
  }

  /** Returns funds after settlement. Supports partial via amountCents. */
  async refundTransaction(
    transactionId: number,
    amountCents: number,
  ): Promise<PaymobRawTransaction> {
    return this.request<PaymobRawTransaction>(
      '/api/acceptance/void_refund/refund',
      {
        method: 'POST',
        headers: this.secretHeaders(),
        body: JSON.stringify({
          transaction_id: transactionId,
          amount_cents: amountCents,
        }),
      },
    );
  }

  /** Cancels an unsettled card transaction. Full amount only. */
  async voidTransaction(transactionId: number): Promise<PaymobRawTransaction> {
    return this.request<PaymobRawTransaction>(
      '/api/acceptance/void_refund/void',
      {
        method: 'POST',
        headers: this.secretHeaders(),
        body: JSON.stringify({ transaction_id: transactionId }),
      },
    );
  }

  /**
   * Transaction Inquiry uses a different auth flow to the Intention API: the
   * API Key is exchanged for a short-lived token. Not cached — the tokens are
   * short-lived and inquiries are infrequent by design.
   */
  private async getInquiryToken(): Promise<string> {
    const data = await this.request<{ token: string }>('/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: getPaymobApiKey() }),
    });
    return data.token;
  }

  /**
   * The reconciliation lookup. We store paymobOrderId at intention creation,
   * so this resolves the true state of every attempt against that order even
   * when no callback ever arrived — which is the normal case for wallets,
   * whose callback URL lives on the integration rather than the intention.
   */
  async getOrderWithTransactions(
    paymobOrderId: number,
  ): Promise<{ transactions: PaymobRawTransaction[] }> {
    const token = await this.getInquiryToken();
    const data = await this.request<{ transactions?: PaymobRawTransaction[] }>(
      `/api/ecommerce/orders/${paymobOrderId}?token=${encodeURIComponent(token)}`,
      { method: 'GET' },
    );
    return { transactions: data.transactions ?? [] };
  }
}
