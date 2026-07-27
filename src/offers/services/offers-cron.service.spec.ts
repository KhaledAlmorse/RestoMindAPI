import { Types } from 'mongoose';
import { OffersCronService } from './offers-cron.service';
import { OfferStatusEnum } from 'src/Common/Types';

describe('OffersCronService', () => {
  let service: OffersCronService;
  let offerRepo: jest.Mocked<any>;
  let offerRulesService: jest.Mocked<any>;

  const productId = new Types.ObjectId();

  beforeEach(() => {
    offerRepo = {
      updateMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    };
    offerRulesService = { assertActiveConflict: jest.fn() };
    service = new OffersCronService(offerRepo, offerRulesService);
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
});
