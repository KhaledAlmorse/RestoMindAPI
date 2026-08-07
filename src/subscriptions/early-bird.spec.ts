import { planPriceCents } from './plan-pricing';
import { SubscriptionsService } from './subscriptions.service';

const DISCOUNT = 33.3333;

const BASIC = {
  slug: 'basic',
  label: 'Basic',
  productCap: 1000,
  archived: false,
  prices: { monthly: 30_000, halfYearly: 165_000, yearly: 300_000 },
};
const PLUS = {
  slug: 'plus',
  label: 'Plus',
  productCap: 3000,
  archived: false,
  prices: { monthly: 60_000, halfYearly: 330_000, yearly: 600_000 },
};
const SCALE = {
  slug: 'scale',
  label: 'Scale',
  productCap: null,
  archived: false,
  prices: { monthly: 150_000, halfYearly: 825_000, yearly: 1_500_000 },
};

describe('early-bird pricing', () => {
  describe('planPriceCents', () => {
    it('charges the standard price by default', () => {
      expect(planPriceCents(BASIC, 'monthly', false, DISCOUNT)).toBe(30_000);
      expect(planPriceCents(PLUS, 'monthly', false, DISCOUNT)).toBe(60_000);
      expect(planPriceCents(SCALE, 'monthly', false, DISCOUNT)).toBe(150_000);
    });

    it('charges the early-bird price when the seat applies', () => {
      expect(planPriceCents(BASIC, 'monthly', true, DISCOUNT)).toBe(20_000);
      expect(planPriceCents(PLUS, 'monthly', true, DISCOUNT)).toBe(40_000);
      expect(planPriceCents(SCALE, 'monthly', true, DISCOUNT)).toBe(100_000);
    });

    it('keeps every early-bird price below its standard price', () => {
      // Guards against a discount edit that somehow raises a price, which
      // would quietly charge early birds MORE than everyone else.
      for (const plan of [BASIC, PLUS, SCALE]) {
        for (const interval of ['monthly', 'halfYearly', 'yearly'] as const) {
          expect(planPriceCents(plan, interval, true, DISCOUNT)!).toBeLessThan(
            planPriceCents(plan, interval, false, DISCOUNT)!,
          );
        }
      }
    });
  });

  describe('what the merchant is actually quoted and charged', () => {
    let service: SubscriptionsService;
    let restaurantRepository: any;
    let paymentsService: any;
    let systemSettingsService: any;
    let plansService: any;

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

      restaurantRepository = {
        findOne: jest.fn().mockResolvedValue(restaurant),
      };
      paymentsService = {
        registerFulfiller: jest.fn(),
        createPayment: jest.fn().mockResolvedValue({ checkoutUrl: 'https://x' }),
      };
      systemSettingsService = {
        get: jest.fn().mockResolvedValue({
          earlyBirdEnabled: true,
          earlyBirdDiscountPercent: DISCOUNT,
        }),
      };
      plansService = {
        listSellable: jest.fn().mockResolvedValue([BASIC, PLUS, SCALE]),
        getBySlug: jest.fn().mockResolvedValue(BASIC),
        getTrialPlan: jest.fn().mockResolvedValue(PLUS),
        nextPlanAbove: jest.fn().mockResolvedValue(null),
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
        plansService,
      );
    });

    const basicOf = (mine: any) =>
      mine.plans.find((plan: any) => plan.slug === 'basic')!;

    it('quotes the early-bird price on the billing screen', async () => {
      const mine = await service.getMine('6a749eca2127a5df364bf4a6');
      const basic = basicOf(mine);

      expect(mine.earlyBird).toBe(true);
      expect(basic.intervals.monthly.priceEGP).toBe(200);
      // The struck-through number the screen shows next to it.
      expect(basic.intervals.monthly.standardPriceEGP).toBe(300);
    });

    it('quotes every interval at the discounted price', async () => {
      const basic = basicOf(await service.getMine('6a749eca2127a5df364bf4a6'));
      expect(basic.intervals.halfYearly.priceEGP).toBe(1100);
      expect(basic.intervals.yearly.priceEGP).toBe(2000);
    });

    it('charges the same price it quoted', async () => {
      // The screen and the checkout reading different numbers is the failure
      // that matters here: the merchant sees 200 and is billed 300.
      await service.startCheckout(
        '6a749ec92127a5df364bf47f',
        '6a749eca2127a5df364bf4a6',
        'basic',
        'monthly',
        'card' as any,
      );

      expect(paymentsService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ amountCents: 20_000 }),
      );
    });

    it('charges the discounted yearly price for a yearly checkout', async () => {
      await service.startCheckout(
        '6a749ec92127a5df364bf47f',
        '6a749eca2127a5df364bf4a6',
        'basic',
        'yearly',
        'card' as any,
      );

      expect(paymentsService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ amountCents: 200_000, interval: 'yearly' }),
      );
    });

    it('reverts to the standard price once the platform switch is off', async () => {
      // The merchant keeps the flag — the period they already paid for stands —
      // but the next renewal is priced normally.
      systemSettingsService.get.mockResolvedValue({
        earlyBirdEnabled: false,
        earlyBirdDiscountPercent: DISCOUNT,
      });

      const mine = await service.getMine('6a749eca2127a5df364bf4a6');
      expect(mine.earlyBird).toBe(false);
      expect(basicOf(mine).intervals.monthly.priceEGP).toBe(300);

      await service.startCheckout(
        '6a749ec92127a5df364bf47f',
        '6a749eca2127a5df364bf4a6',
        'basic',
        'monthly',
        'card' as any,
      );
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
      const basic = basicOf(mine);

      expect(mine.earlyBird).toBe(false);
      expect(basic.intervals.monthly.priceEGP).toBe(300);
      expect(basic.intervals.monthly.standardPriceEGP).toBe(null);
    });
  });
});
