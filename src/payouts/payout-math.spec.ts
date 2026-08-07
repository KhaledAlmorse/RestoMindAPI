import {
  LedgerLine,
  adjustmentLine,
  payoutDecision,
  refundLines,
  saleLine,
  splitProRata,
  summarise,
} from './payout-math';

const at = (iso: string) => new Date(iso);

describe('splitProRata', () => {
  it('splits in proportion to the weights', () => {
    expect(splitProRata(10_000, [6_000, 4_000])).toEqual([6_000, 4_000]);
  });

  it('sums to the total exactly when the split does not divide evenly', () => {
    const parts = splitProRata(1_000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_000);
    expect(parts).toEqual([334, 333, 333]); // largest remainder, biggest first
  });

  it('never emits a negative or fractional part', () => {
    const parts = splitProRata(7, [5, 3, 1]);
    expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(7);
  });

  it('falls back to an equal split when every weight is zero', () => {
    expect(splitProRata(300, [0, 0, 0])).toEqual([100, 100, 100]);
  });

  it('preserves sign for a negative total', () => {
    const parts = splitProRata(-1_000, [1, 1, 1]);
    expect(parts).toEqual([-334, -333, -333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-1_000);
  });
});

describe('saleLine', () => {
  it('credits gross minus commission for an online order', () => {
    const line = saleLine({
      _id: 'o1',
      paymentMethod: 'Card',
      finalTotalPrice: 100,
      commissionCents: 1_500,
      deliveredAt: at('2026-08-01T12:00:00Z'),
    } as any);

    expect(line.kind).toBe('sale');
    expect(line.grossCents).toBe(10_000);
    expect(line.commissionCents).toBe(1_500);
    expect(line.merchantNetCents).toBe(8_500);
  });

  it('debits only the commission for a cash-on-delivery order', () => {
    // The merchant already holds the customer's cash, so RestoMind owes them
    // nothing and is owed the commission.
    const line = saleLine({
      _id: 'o2',
      paymentMethod: 'Cash on Delivery',
      finalTotalPrice: 100,
      commissionCents: 1_500,
      deliveredAt: at('2026-08-01T12:00:00Z'),
    } as any);

    expect(line.grossCents).toBe(0);
    expect(line.merchantNetCents).toBe(-1_500);
  });
});

describe('refundLines', () => {
  const orderA = {
    _id: 'a',
    restaurantId: 'r1',
    paymentMethod: 'Card',
    finalTotalPrice: 60,
    commissionCents: 900,
    deliveredAt: at('2026-08-01T12:00:00Z'),
  } as any;
  const orderB = {
    _id: 'b',
    restaurantId: 'r2',
    paymentMethod: 'Card',
    finalTotalPrice: 40,
    commissionCents: 600,
    deliveredAt: at('2026-08-01T12:00:00Z'),
  } as any;

  it('reverses the commission pro-rata on a partial refund', () => {
    // Half of order A refunded: 3000 of 6000 piasters, so 450 of 900 commission.
    const [line] = refundLines(
      { _id: 'f1', orderId: 'a', amountCents: 3_000, completedAt: at('2026-08-02T09:00:00Z') } as any,
      [orderA],
    );

    expect(line.kind).toBe('refund');
    expect(line.grossCents).toBe(-3_000);
    expect(line.commissionCents).toBe(-450);
    expect(line.merchantNetCents).toBe(-2_550);
  });

  it('splits a group-wide refund across restaurants by order total', () => {
    // One Refund row, no orderId, covering a 100 EGP group split 60/40.
    const lines = refundLines(
      { _id: 'f2', orderId: undefined, amountCents: 10_000, completedAt: at('2026-08-02T09:00:00Z') } as any,
      [orderA, orderB],
    );

    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.restaurantId)).toEqual(['r1', 'r2']);
    expect(lines.map((l) => l.grossCents)).toEqual([-6_000, -4_000]);
    expect(lines.reduce((sum, l) => sum + l.grossCents, 0)).toBe(-10_000);
  });

  it('returns the commission to RestoMind when a cash order is refunded', () => {
    // The merchant hands cash back, so their commission debt shrinks.
    const [line] = refundLines(
      { _id: 'f3', orderId: 'c', amountCents: 5_000, completedAt: at('2026-08-02T09:00:00Z') } as any,
      [{ _id: 'c', restaurantId: 'r1', paymentMethod: 'Cash on Delivery', finalTotalPrice: 50, commissionCents: 750, deliveredAt: at('2026-08-01T12:00:00Z') } as any],
    );

    expect(line.grossCents).toBe(0);
    expect(line.merchantNetCents).toBe(750);
  });

  it('emits no line for an order that was never delivered', () => {
    // A cancelled-before-delivery order never produced a sale line, so
    // reversing its commission would credit the merchant for a sale that was
    // never booked.
    const lines = refundLines(
      { _id: 'f5', orderId: 'c', amountCents: 5_000, completedAt: at('2026-08-02T09:00:00Z') } as any,
      [{ _id: 'c', restaurantId: 'r1', paymentMethod: 'Cash on Delivery', finalTotalPrice: 50, commissionCents: 750 } as any],
    );

    expect(lines).toEqual([]);
  });

  it('reports an undelivered order under includeUndelivered, but never its commission', () => {
    // The stuck-refund report needs the gross; crediting commission here would
    // be the very phantom credit the delivered filter exists to stop.
    const [line] = refundLines(
      { _id: 'f6', orderId: 'c', amountCents: 5_000, completedAt: at('2026-08-02T09:00:00Z') } as any,
      [{ _id: 'c', restaurantId: 'r1', paymentMethod: 'Card', finalTotalPrice: 50, commissionCents: 750 } as any],
      true,
    );

    expect(line.grossCents).toBe(-5_000);
    expect(line.commissionCents).toBe(0);
  });

  it('never reverses more commission than the order carried', () => {
    // 7000 refunded against a 6000c order: naive pro-rata would compute
    // round(900 * 7000/6000) = 1050, more commission than the order ever
    // carried. The cap must bring it back to 900.
    const [line] = refundLines(
      { _id: 'f4', orderId: 'a', amountCents: 7_000, completedAt: at('2026-08-02T09:00:00Z') } as any,
      [orderA],
    );

    expect(line.commissionCents).toBe(-900);
  });
});

describe('summarise', () => {
  it('totals the lines and splits VAT out of the net commission', () => {
    const lines: LedgerLine[] = [
      saleLine({ _id: 'o1', restaurantId: 'r1', paymentMethod: 'Card', finalTotalPrice: 100, commissionCents: 1_500, deliveredAt: at('2026-08-01T12:00:00Z') } as any),
      adjustmentLine({ _id: 'j1', restaurantId: 'r1', amountCents: -500, reason: 'chargeback', effectiveAt: at('2026-08-03T00:00:00Z') } as any),
    ];

    const totals = summarise(lines);

    expect(totals.merchantNetCents).toBe(8_000);
    expect(totals.commissionCents).toBe(1_500);
    // 1500 VAT-inclusive at 14% -> 184 VAT, 1316 net.
    expect(totals.commissionVatCents).toBe(184);
    expect(totals.commissionNetCents).toBe(1_316);
    expect(totals.commissionNetCents + totals.commissionVatCents).toBe(1_500);
  });

  it('returns zeroes for an empty period rather than NaN', () => {
    const totals = summarise([]);
    expect(totals.merchantNetCents).toBe(0);
    expect(totals.commissionVatCents).toBe(0);
  });
});

describe('payoutDecision', () => {
  it('pays out when the merchant is owed more than the minimum', () => {
    expect(payoutDecision(20_000, true)).toEqual({ action: 'pay', direction: 'to_merchant' });
  });

  it('carries forward an amount below the minimum instead of paying it', () => {
    expect(payoutDecision(100, true)).toEqual({ action: 'carry', reason: 'below_minimum' });
  });

  it('carries forward exactly zero', () => {
    expect(payoutDecision(0, true)).toEqual({ action: 'carry', reason: 'below_minimum' });
  });

  it('collects from the merchant when the net is negative', () => {
    expect(payoutDecision(-20_000, true)).toEqual({ action: 'collect', direction: 'from_merchant' });
  });

  it('blocks a payable statement when no destination is on file', () => {
    // Still a statement — just not a transfer. Discovering a missing IBAN on
    // transfer day is the failure this prevents.
    expect(payoutDecision(20_000, false)).toEqual({ action: 'blocked', reason: 'no_payout_destination' });
  });

  it('still allows collection from a merchant with no destination on file', () => {
    expect(payoutDecision(-20_000, false)).toEqual({ action: 'collect', direction: 'from_merchant' });
  });
});
