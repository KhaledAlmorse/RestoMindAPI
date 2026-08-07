import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PaymentMethodEnum } from 'src/Common/Types';

/**
 * Egypt. Test and live share the same URL — the mode is decided entirely by
 * which keys and Integration IDs are used, never by the host.
 */
export const PAYMOB_BASE_URL =
  process.env.PAYMOB_BASE_URL || 'https://accept.paymob.com';

/**
 * Read lazily rather than at module load: the app must still boot (and every
 * non-payment route must still work) on an environment where Paymob has not
 * been configured yet.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new InternalServerErrorException(
      `${name} is not configured — Paymob payments are unavailable`,
    );
  }
  return value;
}

/**
 * Where Paymob POSTs the callback, and where the customer lands afterwards.
 *
 * Required rather than defaulted: an unset value would interpolate the string
 * "undefined" into the notification_url, Paymob would never reach us, and
 * every payment would hang in `pending` until the sweeper caught it. Better
 * to refuse to create the intention at all.
 */
export const getApiPublicUrl = () =>
  required('API_PUBLIC_URL').replace(/\/+$/, '');
export const getFrontendUrl = () =>
  required('FRONTEND_URL').replace(/\/+$/, '');

export const getPaymobSecretKey = () => required('PAYMOB_SECRET_KEY');
export const getPaymobPublicKey = () => required('PAYMOB_PUBLIC_KEY');
export const getPaymobApiKey = () => required('PAYMOB_API_KEY');
export const getPaymobHmacSecret = () => required('PAYMOB_HMAC_SECRET');

const INTEGRATION_ENV: Record<PaymentMethodEnum, string> = {
  [PaymentMethodEnum.CARD]: 'PAYMOB_INTEGRATION_ID_CARD',
  [PaymentMethodEnum.WALLET]: 'PAYMOB_INTEGRATION_ID_WALLET',
};

/**
 * Available methods are derived from which Integration IDs are actually
 * configured, so enabling Vodafone Cash is one environment variable rather
 * than a code change and a deploy.
 */
export function getEnabledMethods(): PaymentMethodEnum[] {
  return (Object.keys(INTEGRATION_ENV) as PaymentMethodEnum[]).filter(
    (method) => Boolean(process.env[INTEGRATION_ENV[method]]),
  );
}

export function getIntegrationId(method: PaymentMethodEnum): number {
  const raw = process.env[INTEGRATION_ENV[method]];
  if (!raw) {
    throw new BadRequestException(
      `Payment method "${method}" is not enabled on this account`,
    );
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new InternalServerErrorException(
      `${INTEGRATION_ENV[method]} must be an integer, got "${raw}"`,
    );
  }
  return parsed;
}

/** Minutes an unpaid checkout may hold its stock, when nothing is configured. */
const DEFAULT_PAYMENT_WINDOW_MINUTES = 5;

/**
 * How long an abandoned checkout may hold its reserved stock.
 *
 * One value feeding four coupled call sites: the Paymob intention's own
 * lifetime, the reconciliation sweeper's grace period, and the guard that stops
 * a customer opening a second checkout while one is live. They must not drift
 * apart — a grace shorter than the intention expires an order the customer can
 * still legitimately pay for, and that late success then has to be
 * auto-refunded (see PaymentsService.autoRefundLateSuccess). A grace longer
 * than the guard window lets a customer start a second order while the first
 * still holds stock.
 *
 * Read per call rather than captured at module load, so the value is settable
 * per environment without a code change and tests can vary it.
 */
export function getPaymentWindowMs(): number {
  const raw = process.env.PAYMENT_WINDOW_MINUTES;
  const minutes =
    raw === undefined || raw === '' ? DEFAULT_PAYMENT_WINDOW_MINUTES : Number(raw);

  // Strict rather than falling back to the default: a typo'd value silently
  // becoming 5 minutes is a stock-holding window nobody can explain later.
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new InternalServerErrorException(
      `PAYMENT_WINDOW_MINUTES must be a positive number of minutes, got "${raw}"`,
    );
  }

  return Math.round(minutes * 60 * 1000);
}

/**
 * The Unified Checkout redirect. Public key only — the Secret Key must never
 * reach the browser.
 */
export function buildCheckoutUrl(clientSecret: string): string {
  const publicKey = encodeURIComponent(getPaymobPublicKey());
  const secret = encodeURIComponent(clientSecret);
  return `${PAYMOB_BASE_URL}/unifiedcheckout/?publicKey=${publicKey}&clientSecret=${secret}`;
}
