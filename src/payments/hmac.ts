import { createHmac, timingSafeEqual } from 'crypto';

/**
 * The exact field order Paymob specifies for the Transaction Processed
 * callback. This is NOT alphabetical — it is the documented order, and
 * reordering it silently breaks every verification (the hash still computes,
 * it just never matches).
 *
 * Source: https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac
 */
const TRANSACTION_HMAC_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order.id',
  'owner',
  'pending',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
] as const;

function readPath(obj: Record<string, any>, path: string): unknown {
  return path
    .split('.')
    .reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/**
 * Builds the concatenated string Paymob signs.
 *
 * Values are used exactly as received — no date reformatting, no number
 * rounding, no separators. Any normalisation here produces a different string
 * from the one Paymob hashed, and every callback would then be rejected.
 */
export function buildTransactionHmacString(obj: Record<string, any>): string {
  return TRANSACTION_HMAC_FIELDS.map((field) => {
    const value = readPath(obj, field);
    if (value === undefined || value === null) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
  }).join('');
}

/**
 * Verifies a callback's HMAC.
 *
 * Returns false rather than throwing, so the caller can always answer Paymob
 * with 200 — a non-2xx makes Paymob retry, and retrying a forged callback
 * achieves nothing but load.
 */
export function verifyTransactionHmac(
  obj: Record<string, any>,
  receivedHmac: string,
  secret: string,
): boolean {
  if (!obj || !receivedHmac || !secret) return false;

  const expected = createHmac('sha512', secret)
    .update(buildTransactionHmacString(obj))
    .digest('hex');

  const received = receivedHmac.toLowerCase();

  // timingSafeEqual throws on a length mismatch, so check length first. The
  // length of a SHA-512 hex digest is not a secret, so this leaks nothing.
  if (received.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
