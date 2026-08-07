import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SubscriptionPlansService } from './subscription-plans.service';

const PLAN = (over: any = {}) => ({
  _id: 'p1',
  slug: 'basic',
  label: 'Basic',
  productCap: 1000,
  prices: { monthly: 30000, halfYearly: 165000, yearly: 300000 },
  sortOrder: 0,
  archived: false,
  isTrialPlan: false,
  ...over,
});

describe('SubscriptionPlansService', () => {
  let planRepo: any;
  let restaurantRepo: any;
  let paymentRepo: any;
  let service: SubscriptionPlansService;

  /**
   * Honours the `archived` filter the real repository applies in Mongo — a
   * mock that ignored it would let listSellable() look broken (or, worse,
   * look fine while shipping archived plans to the billing screen).
   */
  const seedPlans = (plans: any[]) =>
    planRepo.findMany.mockImplementation(({ filters }: any = {}) =>
      Promise.resolve(
        filters?.archived === false
          ? plans.filter((plan) => !plan.archived)
          : plans,
      ),
    );

  beforeEach(() => {
    planRepo = {
      findMany: jest.fn().mockResolvedValue([PLAN()]),
      findOne: jest.fn().mockResolvedValue(PLAN()),
      create: jest.fn().mockImplementation((doc) => Promise.resolve(doc)),
      update: jest.fn().mockResolvedValue(PLAN()),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      delete: jest.fn().mockResolvedValue(PLAN()),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    restaurantRepo = { countDocuments: jest.fn().mockResolvedValue(0) };
    paymentRepo = { countDocuments: jest.fn().mockResolvedValue(0) };
    service = new SubscriptionPlansService(
      planRepo,
      restaurantRepo,
      paymentRepo,
    );
  });

  it('rejects a create whose ladder is not monotonic', async () => {
    planRepo.findOne.mockResolvedValue(null);
    await expect(
      service.create(
        {
          slug: 'bad',
          label: 'Bad',
          productCap: 10,
          prices: { monthly: 30000, halfYearly: null, yearly: 400000 },
        } as any,
        'admin1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a duplicate slug', async () => {
    planRepo.findOne.mockResolvedValue(PLAN());
    await expect(
      service.create(
        {
          slug: 'basic',
          label: 'X',
          productCap: 10,
          prices: { monthly: 100, halfYearly: null, yearly: null },
        } as any,
        'admin1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to change a slug', async () => {
    await expect(
      service.update('basic', { slug: 'renamed' } as any, 'admin1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates a partial price patch against the merged ladder', async () => {
    // Monthly stays at 30000; yearly alone is patched to a worse per-month rate.
    await expect(
      service.update('basic', { prices: { yearly: 400000 } } as any, 'admin1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets an explicit null withdraw an interval from sale', async () => {
    await service.update('basic', { prices: { yearly: null } } as any, 'admin1');
    expect(planRepo.update.mock.calls[0][0].body.prices).toEqual({
      monthly: 30000,
      halfYearly: 165000,
      yearly: null,
    });
  });

  it('leaves untouched intervals alone on a partial patch', async () => {
    await service.update('basic', { label: 'Basic Plan' } as any, 'admin1');
    expect(planRepo.update.mock.calls[0][0].body.prices).toEqual({
      monthly: 30000,
      halfYearly: 165000,
      yearly: 300000,
    });
  });

  it('refuses to delete a plan restaurants still hold', async () => {
    restaurantRepo.countDocuments.mockResolvedValue(17);
    await expect(service.remove('basic', 'admin1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses to delete a plan payments reference', async () => {
    paymentRepo.countDocuments.mockResolvedValue(240);
    await expect(service.remove('basic', 'admin1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deletes a plan nobody has ever bought', async () => {
    await expect(service.remove('basic', 'admin1')).resolves.toBeDefined();
    expect(planRepo.delete).toHaveBeenCalled();
  });

  it('refuses to archive the trial plan', async () => {
    planRepo.findOne.mockResolvedValue(PLAN({ isTrialPlan: true }));
    await expect(
      service.setArchived('basic', true, 'admin1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows un-archiving without the trial-plan guard firing', async () => {
    planRepo.findOne.mockResolvedValue(PLAN({ archived: true }));
    await expect(
      service.setArchived('basic', false, 'admin1'),
    ).resolves.toBeDefined();
  });

  it('clears isTrialPlan elsewhere when setting it', async () => {
    await service.update('basic', { isTrialPlan: true } as any, 'admin1');
    expect(planRepo.updateMany).toHaveBeenCalledWith(
      { slug: { $ne: 'basic' } },
      { isTrialPlan: false },
    );
  });

  it('throws NotFound for an unknown slug', async () => {
    planRepo.findOne.mockResolvedValue(null);
    await expect(service.getBySlug('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('excludes archived and unpriced plans from listSellable', async () => {
    seedPlans([
      PLAN({ slug: 'a' }),
      PLAN({ slug: 'b', archived: true }),
      PLAN({
        slug: 'c',
        prices: { monthly: null, halfYearly: null, yearly: null },
      }),
    ]);
    const sellable = await service.listSellable();
    expect(sellable.map((plan: any) => plan.slug)).toEqual(['a']);
  });

  it('still lists archived plans for the admin screen', async () => {
    seedPlans([PLAN({ slug: 'a' }), PLAN({ slug: 'b', archived: true })]);
    expect((await service.list(true)).map((plan: any) => plan.slug)).toEqual([
      'a',
      'b',
    ]);
  });

  it('never offers an archived plan as an upgrade', async () => {
    seedPlans([
      PLAN({ slug: 'basic', productCap: 1000 }),
      PLAN({ slug: 'plus', productCap: 3000, archived: true }),
      PLAN({ slug: 'scale', productCap: null }),
    ]);
    expect((await service.nextPlanAbove(1000))?.slug).toBe('scale');
  });

  it('finds the cheapest plan above a cap', async () => {
    seedPlans([
      PLAN({ slug: 'basic', productCap: 1000 }),
      PLAN({ slug: 'plus', productCap: 3000 }),
      PLAN({ slug: 'scale', productCap: null }),
    ]);
    expect((await service.nextPlanAbove(1000))?.slug).toBe('plus');
    expect((await service.nextPlanAbove(3000))?.slug).toBe('scale');
    expect(await service.nextPlanAbove(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
