import { SubscriptionsService } from './subscriptions.service';
import { TIERS, tierPriceCents } from './subscription-tiers.config';

describe('early-bird pricing', () => {
  describe('tierPriceCents', () => {
    it('charges the standard price by default', () => {
      expect(tierPriceCents('basic')).toBe(30_000);
      expect(tierPriceCents('plus')).toBe(60_000);
      expect(tierPriceCents('scale')).toBe(150_000);
    });

    it('charges the early-bird price when the seat applies', () => {
      expect(tierPriceCents('basic', true)).toBe(20_000);
      expect(tierPriceCents('plus', true)).toBe(40_000);
      expect(tierPriceCents('scale', true)).toBe(100_000);
    });

    it('keeps every early-bird price below its standard price', () => {
      // Guards against a future edit that raises one and not the other, which
      // would quietly charge early birds MORE than everyone else.
      for (const tier of Object.values(TIERS)) {
        expect(tier.earlyBirdEGP).toBeLessThan(tier.priceEGP);
      }
    });
  });

  describe('what the merchant is actually quoted and charged', () => {
    let service: SubscriptionsService;
    let restaurantRepository: any;
    let paymentsService: any;
    let systemSettingsService: any;

    const restaurant = {
      _id: '6a749eca2127a5df364bf4a6',
      subscription: { earlyBird: true },
      address: { street: 'A', city: 'Cairo' },
    };

    beforeEach(() => {
      // startCheckout builds Paymob callback URLs and refuses to run without
      // these; the values are never dereferenced here.
      process.env.API_PUBLIC_URL ??= 'http://localhost:3004/';
      process.env.FRONTEND_URL ??= 'http://localhost:3000/';

      restaurantRepository = { findOne: jest.fn().mockResolvedValue(restaurant) };
      paymentsService = {
        registerFulfiller: jest.fn(),
        createPayment: jest.fn().mockResolvedValue({ checkoutUrl: 'https://x' }),
      };
      systemSettingsService = {
        get: jest.fn().mockResolvedValue({ earlyBirdEnabled: true }),
      };

      service = new SubscriptionsService(
        restaurantRepository,
        { countDocuments: jest.fn().mockResolvedValue(0) } as any,
        {
          findOne: jest.fn().mockResolvedValue({
            _id: '6a749ec92127a5df364bf47f',
            firstName: 'A',
            lastName: 'B',
            phone: '+20',
            email: 'a@b.c',
          }),
        } as any,
        {
          findMany: jest.fn().mockResolvedValue([]),
          findOne: jest.fn().mockResolvedValue(null),
        } as any,
        paymentsService,
        systemSettingsService,
      );
    });

    it('quotes the early-bird price on the billing screen', async () => {
      const mine = await service.getMine('6a749eca2127a5df364bf4a6');
      const basic = mine.tiers.find((t) => t.name === 'basic')!;

      expect(mine.earlyBird).toBe(true);
      expect(basic.priceEGP).toBe(200);
      // The struck-through number the screen shows next to it.
      expect(basic.standardPriceEGP).toBe(300);
    });

    it('charges the same price it quoted', async () => {
      // The screen and the checkout reading different numbers is the failure
      // that matters here: the merchant sees 200 and is billed 300.
      await service.startCheckout('6a749ec92127a5df364bf47f', '6a749eca2127a5df364bf4a6', 'basic', 'card' as any);

      expect(paymentsService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ amountCents: 20_000 }),
      );
    });

    it('reverts to the standard price once the platform switch is off', async () => {
      // The merchant keeps the flag — the month they already paid for stands —
      // but the next renewal is priced normally.
      systemSettingsService.get.mockResolvedValue({ earlyBirdEnabled: false });

      const mine = await service.getMine('6a749eca2127a5df364bf4a6');
      expect(mine.earlyBird).toBe(false);
      expect(mine.tiers.find((t) => t.name === 'basic')!.priceEGP).toBe(300);

      await service.startCheckout('6a749ec92127a5df364bf47f', '6a749eca2127a5df364bf4a6', 'basic', 'card' as any);
      expect(paymentsService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ amountCents: 30_000 }),
      );
    });

    it('charges a merchant with no seat the standard price', async () => {
      restaurantRepository.findOne.mockResolvedValue({
        ...restaurant,
        subscription: {},
      });

      const mine = await service.getMine('6a749eca2127a5df364bf4a6');
      expect(mine.earlyBird).toBe(false);
      expect(mine.tiers.find((t) => t.name === 'basic')!.priceEGP).toBe(300);
      expect(mine.tiers.find((t) => t.name === 'basic')!.standardPriceEGP).toBe(
        null,
      );
    });
  });
});
