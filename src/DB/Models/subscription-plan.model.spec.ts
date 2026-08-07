import { SchemaFactory } from '@nestjs/mongoose';
import { model } from 'mongoose';
import { SubscriptionPlan } from './subscription-plan.model';
import { capValue, INTERVAL_MONTHS } from 'src/subscriptions/billing-interval';

describe('SubscriptionPlan schema', () => {
  const schema = SchemaFactory.createForClass(SubscriptionPlan);
  const PlanModel = model('SubscriptionPlanSpec', schema);

  it('defaults an unpriced interval to null rather than 0', () => {
    const doc = new PlanModel({ slug: 'basic', label: 'Basic' });
    expect(doc.prices.monthly).toBeNull();
    expect(doc.prices.halfYearly).toBeNull();
    expect(doc.prices.yearly).toBeNull();
  });

  it('treats a null productCap as unlimited', () => {
    const doc = new PlanModel({
      slug: 'scale',
      label: 'Scale',
      productCap: null,
    });
    expect(doc.productCap).toBeNull();
    expect(capValue(doc.productCap)).toBe(Number.POSITIVE_INFINITY);
  });

  it('stores prices as integer cents', () => {
    const doc = new PlanModel({
      slug: 'basic',
      label: 'Basic',
      productCap: 1000,
      prices: { monthly: 30000, halfYearly: 165000, yearly: 300000 },
    });
    expect(doc.prices.yearly).toBe(300000);
  });

  it('orders intervals by length', () => {
    expect(INTERVAL_MONTHS.monthly).toBe(1);
    expect(INTERVAL_MONTHS.halfYearly).toBe(6);
    expect(INTERVAL_MONTHS.yearly).toBe(12);
  });
});
