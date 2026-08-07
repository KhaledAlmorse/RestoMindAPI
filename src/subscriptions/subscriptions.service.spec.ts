import { BadRequestException, ConflictException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';

const BASIC = {
  slug: 'basic',
  label: 'Basic',
  productCap: 1000,
  archived: false,
  prices: { monthly: 30_000, halfYearly: 165_000, yearly: 300_000 },
};

const RESTAURANT_ID = '6a749eca2127a5df364bf4a6';
const USER_ID = '6a749ec92127a5df364bf47f';

describe('SubscriptionsService — interval billing', () => {
  let service: SubscriptionsService;
  let restaurantRepository: any;
  let paymentRepository: any;
  let paymentsService: any;
  let plansService: any;

  const PAID = (over: any = {}) => ({
    _id: 'pay1',
    restaurantId: RESTAURANT_ID,
    tier: 'basic',
    interval: 'yearly',
    planLabel: 'Basic',
    planProductCap: 1000,
    ...over,
  });

  /** The body onPaid wrote to the restaurant. */
  const written = () => restaurantRepository.update.mock.calls[0][0].body;

  beforeEach(() => {
    process.env.API_PUBLIC_URL ??= 'http://localhost:3004/';
    process.env.FRONTEND_URL ??= 'http://localhost:3000/';

    restaurantRepository = {
      findOne: jest.fn().mockResolvedValue({
        _id: RESTAURANT_ID,
        subscription: {},
        address: { street: 'A', city: 'Cairo' },
      }),
      update: jest.fn().mockResolvedValue({}),
    };
    paymentRepository = {
      findMany: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    };
    paymentsService = {
      registerFulfiller: jest.fn(),
      createPayment: jest.fn().mockResolvedValue({ checkoutUrl: 'https://x' }),
    };
    plansService = {
      listSellable: jest.fn().mockResolvedValue([BASIC]),
      getBySlug: jest.fn().mockResolvedValue(BASIC),
      getTrialPlan: jest.fn().mockResolvedValue(BASIC),
      nextPlanAbove: jest.fn().mockResolvedValue(null),
    };

    service = new SubscriptionsService(
      restaurantRepository,
      { countDocuments: jest.fn().mockResolvedValue(0) } as any,
      {
        findOne: jest.fn().mockResolvedValue({
          _id: USER_ID,
          firstName: 'A',
          lastName: 'B',
          phone: '+20',
          email: 'a@b.c',
        }),
      } as any,
      paymentRepository,
      paymentsService,
      {
        get: jest.fn().mockResolvedValue({
          earlyBirdEnabled: true,
          earlyBirdDiscountPercent: 33.3333,
        }),
      } as any,
      plansService,
    );
  });

  const monthsFromNow = (end: Date) =>
    (end.getFullYear() - new Date().getFullYear()) * 12 +
    (end.getMonth() - new Date().getMonth());

  it('extends the period by the purchased interval, not by one month', async () => {
    await service.onPaid(PAID() as any);

    const end = new Date(written()['subscription.currentPeriodEnd']);
    expect(monthsFromNow(end)).toBe(12);
  });

  it('extends by six months for a half-yearly purchase', async () => {
    await service.onPaid(PAID({ interval: 'halfYearly' }) as any);

    const end = new Date(written()['subscription.currentPeriodEnd']);
    expect(monthsFromNow(end)).toBe(6);
  });

  it('falls back to monthly for a payment written before intervals existed', async () => {
    await service.onPaid(PAID({ interval: undefined }) as any);

    const end = new Date(written()['subscription.currentPeriodEnd']);
    expect(monthsFromNow(end)).toBe(1);
    expect(written()['subscription.interval']).toBe('monthly');
  });

  it('writes the snapshot from the payment, never from the live plan', async () => {
    // An admin shrinks the plan between checkout and settlement.
    plansService.getBySlug.mockResolvedValue({ ...BASIC, productCap: 500 });

    await service.onPaid(PAID() as any);

    expect(written()['subscription.productCapSnapshot']).toBe(1000);
    expect(written()['subscription.planLabelSnapshot']).toBe('Basic');
    expect(written()['subscription.interval']).toBe('yearly');
    expect(written()['subscription.tier']).toBe('basic');
  });

  it('records an unlimited plan as null, not as zero', async () => {
    await service.onPaid(PAID({ planProductCap: null }) as any);
    expect(written()['subscription.productCapSnapshot']).toBeNull();
  });

  it('never touches trialProductCap on purchase', async () => {
    restaurantRepository.findOne.mockResolvedValue({
      _id: RESTAURANT_ID,
      subscription: {
        trialEndsAt: new Date(Date.now() + 8.64e7),
        trialProductCap: 3000,
      },
    });

    await service.onPaid(PAID() as any);

    expect(written()).not.toHaveProperty('subscription.trialProductCap');
  });

  it('refuses checkout for an interval the plan does not sell', async () => {
    plansService.getBySlug.mockResolvedValue({
      ...BASIC,
      prices: { monthly: 30_000, halfYearly: null, yearly: null },
    });

    await expect(
      service.startCheckout(
        USER_ID,
        RESTAURANT_ID,
        'basic',
        'yearly',
        'card' as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses checkout for an archived plan', async () => {
    plansService.getBySlug.mockResolvedValue({ ...BASIC, archived: true });

    await expect(
      service.startCheckout(
        USER_ID,
        RESTAURANT_ID,
        'basic',
        'monthly',
        'card' as any,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('passes the plan snapshot to the payment so it survives a later edit', async () => {
    await service.startCheckout(
      USER_ID,
      RESTAURANT_ID,
      'basic',
      'yearly',
      'card' as any,
    );

    expect(paymentsService.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: 'basic',
        interval: 'yearly',
        planLabel: 'Basic',
        planProductCap: 1000,
      }),
    );
  });

  it('blocks buying the same capacity on the same interval', async () => {
    restaurantRepository.findOne.mockResolvedValue({
      _id: RESTAURANT_ID,
      subscription: {
        tier: 'basic',
        interval: 'monthly',
        currentPeriodEnd: new Date(Date.now() + 8.64e7 * 10),
        productCapSnapshot: 1000,
        planLabelSnapshot: 'Basic',
      },
      address: { street: 'A', city: 'Cairo' },
    });

    await expect(
      service.startCheckout(
        USER_ID,
        RESTAURANT_ID,
        'basic',
        'monthly',
        'card' as any,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows the same capacity on a longer interval', async () => {
    restaurantRepository.findOne.mockResolvedValue({
      _id: RESTAURANT_ID,
      subscription: {
        tier: 'basic',
        interval: 'monthly',
        currentPeriodEnd: new Date(Date.now() + 8.64e7 * 10),
        productCapSnapshot: 1000,
        planLabelSnapshot: 'Basic',
      },
      address: { street: 'A', city: 'Cairo' },
    });

    await expect(
      service.startCheckout(
        USER_ID,
        RESTAURANT_ID,
        'basic',
        'yearly',
        'card' as any,
      ),
    ).resolves.toEqual({ checkoutUrl: 'https://x' });
  });
});
