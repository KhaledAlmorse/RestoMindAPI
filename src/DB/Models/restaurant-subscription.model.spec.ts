import { SchemaFactory } from '@nestjs/mongoose';
import { model } from 'mongoose';
import { Restaurant } from './restaurant.model';
import { SystemSettings } from './system-settings.model';

describe('Restaurant.subscription', () => {
  const RestaurantModel = model(
    'RestaurantSubSpec',
    SchemaFactory.createForClass(Restaurant),
  );

  // The old enum was ['basic','plus','scale']. An admin-created slug must not
  // be rejected at write time — the merchant would already have paid.
  it('accepts a plan slug outside the retired enum', async () => {
    const doc = new RestaurantModel({
      name: 'X',
      subscription: { tier: 'enterprise' },
    });
    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.subscription!.tier).toBe('enterprise');
  });

  it('stores the interval and the purchased snapshots', () => {
    const doc = new RestaurantModel({
      name: 'X',
      subscription: {
        tier: 'basic',
        interval: 'yearly',
        productCapSnapshot: 1000,
        planLabelSnapshot: 'Basic',
        trialProductCap: 3000,
      },
    });
    expect(doc.subscription!.interval).toBe('yearly');
    expect(doc.subscription!.productCapSnapshot).toBe(1000);
    expect(doc.subscription!.planLabelSnapshot).toBe('Basic');
    expect(doc.subscription!.trialProductCap).toBe(3000);
  });

  it('keeps null as the unlimited cap, distinct from unset', () => {
    const doc = new RestaurantModel({
      name: 'X',
      subscription: { tier: 'scale', productCapSnapshot: null },
    });
    expect(doc.subscription!.productCapSnapshot).toBeNull();

    const unset = new RestaurantModel({
      name: 'Y',
      subscription: { tier: 'basic' },
    });
    expect(unset.subscription!.productCapSnapshot).toBeUndefined();
  });
});

describe('SystemSettings', () => {
  const SettingsModel = model(
    'SystemSettingsSpec',
    SchemaFactory.createForClass(SystemSettings),
  );

  // 33.33 yields 10001 EGP for Scale yearly; 33.3333 yields 10000.
  it('defaults the early-bird discount to 33.3333 percent', () => {
    expect(new SettingsModel({}).earlyBirdDiscountPercent).toBe(33.3333);
  });
});
