import { Types } from 'mongoose';
import { OffersCronService } from './offers-cron.service';
import { OfferStatusEnum } from 'src/Common/Types';

describe('OffersCronService', () => {
  let service: OffersCronService;
  let offerRepo: jest.Mocked<any>;
  let restaurantRepo: jest.Mocked<any>;
  let offerRulesService: jest.Mocked<any>;

  const productId = new Types.ObjectId();

  beforeEach(() => {
    offerRepo = {
      updateMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    };
    // No restaurants by default, so the subscription-suspension pass is a
    // no-op and the existing status-transition assertions stay unaffected.
    restaurantRepo = { findMany: jest.fn().mockResolvedValue([]) };
    offerRulesService = { assertActiveConflict: jest.fn() };
    service = new OffersCronService(
      offerRepo,
      restaurantRepo,
      offerRulesService,
    );
  });

  it('skips promoting a scheduled offer when another is already active for the product', async () => {
    const scheduledOffer = {
      _id: new Types.ObjectId(),
      productId,
      status: OfferStatusEnum.SCHEDULED,
    };

    offerRepo.updateMany.mockResolvedValue(undefined);
    offerRepo.findMany
      .mockResolvedValueOnce([scheduledOffer]) // readyToActivate
      .mockResolvedValueOnce([]); // restockCandidates
    offerRulesService.assertActiveConflict.mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      status: OfferStatusEnum.ACTIVE,
    });

    await service.processStatusTransitions();

    expect(offerRepo.update).not.toHaveBeenCalled();
  });

  it('promotes a scheduled offer when no active conflict exists', async () => {
    const scheduledOffer = {
      _id: new Types.ObjectId(),
      productId,
      status: OfferStatusEnum.SCHEDULED,
    };

    offerRepo.updateMany.mockResolvedValue(undefined);
    offerRepo.findMany
      .mockResolvedValueOnce([scheduledOffer]) // readyToActivate
      .mockResolvedValueOnce([]); // restockCandidates
    offerRulesService.assertActiveConflict.mockResolvedValueOnce(null);
    offerRepo.update.mockResolvedValue(undefined);

    await service.processStatusTransitions();

    expect(offerRepo.update).toHaveBeenCalledWith({
      filters: { _id: scheduledOffer._id },
      body: { status: OfferStatusEnum.ACTIVE },
    });
  });

  it('reactivates a restocked sold-out offer with no active conflict', async () => {
    const soldOutOffer = {
      _id: new Types.ObjectId(),
      productId,
      status: OfferStatusEnum.SOLD_OUT,
    };

    offerRepo.updateMany.mockResolvedValue(undefined);
    offerRepo.findMany
      .mockResolvedValueOnce([]) // readyToActivate
      .mockResolvedValueOnce([soldOutOffer]); // restockCandidates
    offerRulesService.assertActiveConflict.mockResolvedValueOnce(null);
    offerRepo.update.mockResolvedValue(undefined);

    await service.processStatusTransitions();

    expect(offerRepo.update).toHaveBeenCalledWith({
      filters: { _id: soldOutOffer._id },
      body: { status: OfferStatusEnum.ACTIVE },
    });
  });

  it('runs the expire/demote/sold-out bulk passes via updateMany', async () => {
    offerRepo.updateMany.mockResolvedValue(undefined);
    offerRepo.findMany.mockResolvedValue([]);

    await service.processStatusTransitions();

    expect(offerRepo.updateMany).toHaveBeenCalledTimes(3);
  });

  describe('subscription suspension', () => {
    const lapsedId = new Types.ObjectId();
    const payingId = new Types.ObjectId();
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const longPast = new Date(Date.now() - 60 * 24 * 3600 * 1000);

    /** The updateMany call whose body sets the given status. */
    function callSetting(status: OfferStatusEnum) {
      return offerRepo.updateMany.mock.calls.find(
        (call: any[]) => call[1]?.status === status,
      );
    }

    beforeEach(() => {
      offerRepo.updateMany.mockResolvedValue(undefined);
      offerRepo.findMany.mockResolvedValue([]);
    });

    it('suspends the offers of a restaurant whose subscription has expired', async () => {
      restaurantRepo.findMany.mockResolvedValue([
        { _id: lapsedId, subscription: { tier: 'basic', currentPeriodEnd: longPast } },
      ]);

      await service.processStatusTransitions();

      const call = callSetting(OfferStatusEnum.SUSPENDED);
      expect(call).toBeDefined();
      expect(call![0].restaurantId.$in).toEqual([lapsedId]);
      // Only live statuses are suspended — never CANCELLED or EXPIRED, which
      // would resurrect them on restore.
      expect(call![0].status.$in).toEqual([
        OfferStatusEnum.ACTIVE,
        OfferStatusEnum.SCHEDULED,
        OfferStatusEnum.SOLD_OUT,
      ]);
    });

    it('does not suspend a restaurant that is still within its grace period', async () => {
      const justLapsed = new Date(Date.now() - 2 * 24 * 3600 * 1000);
      restaurantRepo.findMany.mockResolvedValue([
        { _id: payingId, subscription: { tier: 'basic', currentPeriodEnd: justLapsed } },
      ]);

      await service.processStatusTransitions();

      expect(callSetting(OfferStatusEnum.SUSPENDED)).toBeUndefined();
    });

    it('does not suspend a restaurant that is on trial', async () => {
      restaurantRepo.findMany.mockResolvedValue([
        { _id: payingId, subscription: { trialEndsAt: future } },
      ]);

      await service.processStatusTransitions();

      expect(callSetting(OfferStatusEnum.SUSPENDED)).toBeUndefined();
    });

    it('restores suspended offers to scheduled once the subscription is paid', async () => {
      restaurantRepo.findMany.mockResolvedValue([
        { _id: payingId, subscription: { tier: 'plus', currentPeriodEnd: future } },
      ]);

      await service.processStatusTransitions();

      // Restored to SCHEDULED, not ACTIVE — the existing promote pass decides
      // activation from the date window and stock, so those rules stay in one
      // place.
      const restore = offerRepo.updateMany.mock.calls.find(
        (call: any[]) =>
          call[0]?.status === OfferStatusEnum.SUSPENDED &&
          call[1]?.status === OfferStatusEnum.SCHEDULED,
      );
      expect(restore).toBeDefined();
      expect(restore![0].restaurantId.$in).toEqual([payingId]);
    });

    it('suspends and restores in the same tick when both kinds exist', async () => {
      restaurantRepo.findMany.mockResolvedValue([
        { _id: lapsedId, subscription: { tier: 'basic', currentPeriodEnd: longPast } },
        { _id: payingId, subscription: { tier: 'plus', currentPeriodEnd: future } },
      ]);

      await service.processStatusTransitions();

      expect(callSetting(OfferStatusEnum.SUSPENDED)![0].restaurantId.$in).toEqual([
        lapsedId,
      ]);
      const restore = offerRepo.updateMany.mock.calls.find(
        (call: any[]) => call[0]?.status === OfferStatusEnum.SUSPENDED,
      );
      expect(restore![0].restaurantId.$in).toEqual([payingId]);
    });

    it('treats a restaurant with no subscription at all as lapsed', async () => {
      restaurantRepo.findMany.mockResolvedValue([{ _id: lapsedId }]);

      await service.processStatusTransitions();

      expect(callSetting(OfferStatusEnum.SUSPENDED)![0].restaurantId.$in).toEqual([
        lapsedId,
      ]);
    });
  });
});
