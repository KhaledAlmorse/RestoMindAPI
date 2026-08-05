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
  return (Object.keys(INTEGRATION_ENV) as PaymentMethodEnum[]).filter((method) =>
    Boolean(process.env[INTEGRATION_ENV[method]]),
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

/**
 * The Unified Checkout redirect. Public key only — the Secret Key must never
 * reach the browser.
 */
export function buildCheckoutUrl(clientSecret: string): string {
  const publicKey = encodeURIComponent(getPaymobPublicKey());
  const secret = encodeURIComponent(clientSecret);
  return `${PAYMOB_BASE_URL}/unifiedcheckout/?publicKey=${publicKey}&clientSecret=${secret}`;
}
