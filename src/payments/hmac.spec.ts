import { createHmac } from 'crypto';
import { buildTransactionHmacString, verifyTransactionHmac } from './hmac';

/**
 * The worked example from Paymob's HMAC documentation. The point of pinning
 * it is to prove our concatenation produces the documented string BEFORE
 * hashing — a wrong field order still hashes fine, it just never matches.
 */
const SAMPLE_OBJ = {
  amount_cents: 100,
  created_at: '2020-03-25T18:39:44.719228',
  currency: 'EGP',
  error_occured: false,
  has_parent_transaction: false,
  id: 2556706,
  integration_id: 6741,
  is_3d_secure: true,
  is_auth: false,
  is_capture: false,
  is_refunded: false,
  is_standalone_payment: true,
  is_voided: false,
  order: { id: 4778239 },
  owner: 4705,
  pending: false,
  source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
  success: true,
};

const EXPECTED_STRING =
  '1002020-03-25T18:39:44.719228EGPfalsefalse25567066741truefalse' +
  'falsefalsetruefalse47782394705false2346MasterCardcardtrue';

describe('buildTransactionHmacString', () => {
  it('concatenates the 20 fields in the order Paymob documents', () => {
    expect(buildTransactionHmacString(SAMPLE_OBJ)).toBe(EXPECTED_STRING);
  });

  it('reads order.id from the nested object, distinct from the top-level id', () => {
    const built = buildTransactionHmacString(SAMPLE_OBJ);
    expect(built).toContain('2556706'); // obj.id
    expect(built).toContain('4778239'); // obj.order.id
  });

  it('renders booleans as the literal strings true/false', () => {
    expect(buildTransactionHmacString({ ...SAMPLE_OBJ, success: false })).toMatch(
      /false$/,
    );
  });

  it('does not reformat the raw created_at value', () => {
    expect(buildTransactionHmacString(SAMPLE_OBJ)).toContain(
      '2020-03-25T18:39:44.719228',
    );
  });

  it('renders a missing nested value as empty, never the text "undefined"', () => {
    const noSource = { ...SAMPLE_OBJ, source_data: {} };
    expect(buildTransactionHmacString(noSource)).not.toContain('undefined');
  });

  it('does not throw when order is absent entirely', () => {
    const noOrder: Record<string, any> = { ...SAMPLE_OBJ };
    delete noOrder.order;
    expect(() => buildTransactionHmacString(noOrder)).not.toThrow();
  });
});

describe('verifyTransactionHmac', () => {
  const SECRET = 'test_hmac_secret';
  const validHmac = createHmac('sha512', SECRET)
    .update(EXPECTED_STRING)
    .digest('hex');

  it('accepts a correctly signed payload', () => {
    expect(verifyTransactionHmac(SAMPLE_OBJ, validHmac, SECRET)).toBe(true);
  });

  it('rejects a tampered amount', () => {
    const tampered = { ...SAMPLE_OBJ, amount_cents: 1 };
    expect(verifyTransactionHmac(tampered, validHmac, SECRET)).toBe(false);
  });

  it('rejects a flipped success flag', () => {
    const tampered = { ...SAMPLE_OBJ, success: false };
    expect(verifyTransactionHmac(tampered, validHmac, SECRET)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(verifyTransactionHmac(SAMPLE_OBJ, validHmac, 'wrong')).toBe(false);
  });

  it('rejects an empty or missing hmac without throwing', () => {
    expect(verifyTransactionHmac(SAMPLE_OBJ, '', SECRET)).toBe(false);
    expect(verifyTransactionHmac(SAMPLE_OBJ, undefined as any, SECRET)).toBe(
      false,
    );
  });

  it('rejects a short hmac without throwing (length mismatch)', () => {
    expect(verifyTransactionHmac(SAMPLE_OBJ, 'abc123', SECRET)).toBe(false);
  });

  it('is case-insensitive on the received hex', () => {
    expect(
      verifyTransactionHmac(SAMPLE_OBJ, validHmac.toUpperCase(), SECRET),
    ).toBe(true);
  });

  it('rejects when the secret is missing', () => {
    expect(verifyTransactionHmac(SAMPLE_OBJ, validHmac, '')).toBe(false);
  });
});
