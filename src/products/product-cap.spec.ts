import { ConflictException } from '@nestjs/common';
import { addDays } from 'src/Common/Utils';
import { assertProductCapacity } from './product-cap';

const NOW = new Date();
const active = (cap: number | null) => ({
  currentPeriodEnd: addDays(NOW, 10),
  productCapSnapshot: cap,
  planLabelSnapshot: 'Basic',
});

describe('assertProductCapacity', () => {
  it('allows a create below the cap', () => {
    expect(() => assertProductCapacity(active(1000), 999)).not.toThrow();
  });

  it('blocks a create at the cap', () => {
    expect(() => assertProductCapacity(active(1000), 1000)).toThrow(
      ConflictException,
    );
  });

  it('never blocks an unlimited plan', () => {
    expect(() =>
      assertProductCapacity(active(null), 10_000_000),
    ).not.toThrow();
  });

  it('blocks entirely when the subscription is not active', () => {
    expect(() => assertProductCapacity({}, 0)).toThrow(ConflictException);
    expect(() => assertProductCapacity(undefined, 0)).toThrow(
      ConflictException,
    );
  });

  it('keeps working through the grace window', () => {
    const justLapsed = {
      currentPeriodEnd: addDays(NOW, -1),
      productCapSnapshot: 1000,
      planLabelSnapshot: 'Basic',
    };
    expect(() => assertProductCapacity(justLapsed, 10)).not.toThrow();
  });

  it('honours a live trial cap', () => {
    const trial = { trialEndsAt: addDays(NOW, 5), trialProductCap: 3000 };
    expect(() => assertProductCapacity(trial, 2999)).not.toThrow();
    expect(() => assertProductCapacity(trial, 3000)).toThrow(
      ConflictException,
    );
  });

  it('names the plan the merchant holds, from the snapshot', () => {
    try {
      assertProductCapacity(active(1000), 1000);
      throw new Error('expected a ConflictException');
    } catch (error: any) {
      expect(error.response.message).toContain('Basic');
      expect(error.response.cap).toBe(1000);
      expect(error.response.code).toBe('PRODUCT_LIMIT_REACHED');
    }
  });

  it('carries the upgrade hint when one is supplied', () => {
    try {
      assertProductCapacity(active(1000), 1000, {
        slug: 'plus',
        label: 'Plus',
        priceEGP: 600,
      });
      throw new Error('expected a ConflictException');
    } catch (error: any) {
      expect(error.response.nextPlan).toEqual({
        slug: 'plus',
        label: 'Plus',
        priceEGP: 600,
      });
    }
  });

  it('omits the hint rather than inventing one', () => {
    try {
      assertProductCapacity(active(1000), 1000);
      throw new Error('expected a ConflictException');
    } catch (error: any) {
      expect(error.response.nextPlan).toBeNull();
    }
  });
});
