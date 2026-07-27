import { Types } from 'mongoose';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { OfferRulesService } from './offer-rules.service';
import { OfferStatusEnum } from 'src/Common/Types';

describe('OfferRulesService', () => {
  let service: OfferRulesService;
  let offerRepo: jest.Mocked<any>;

  const productId = new Types.ObjectId().toString();

  beforeEach(() => {
    offerRepo = { findOne: jest.fn() };
    service = new OfferRulesService(offerRepo);
  });

  describe('assertNoOverlap', () => {
    it('rejects a window that intersects an existing live offer', async () => {
      offerRepo.findOne.mockResolvedValueOnce({
        _id: new Types.ObjectId(),
        startDate: new Date('2999-01-03'),
        endDate: new Date('2999-01-07'),
        status: OfferStatusEnum.ACTIVE,
      });

      await expect(
        service.assertNoOverlap(
          productId,
          new Date('2999-01-01'),
          new Date('2999-01-05'),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('accepts an adjacent, non-overlapping window', async () => {
      offerRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.assertNoOverlap(
          productId,
          new Date('2999-01-06'),
          new Date('2999-01-09'),
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertActiveConflict', () => {
    it('returns the conflicting active offer when one exists', async () => {
      const conflict = { _id: new Types.ObjectId(), status: OfferStatusEnum.ACTIVE };
      offerRepo.findOne.mockResolvedValueOnce(conflict);

      const result = await service.assertActiveConflict(productId);
      expect(result).toBe(conflict);
    });

    it('returns null when no active offer exists', async () => {
      offerRepo.findOne.mockResolvedValueOnce(null);

      const result = await service.assertActiveConflict(productId);
      expect(result).toBeNull();
    });
  });

  describe('assertStatusTransition', () => {
    it('allows a legal transition (scheduled -> cancelled)', () => {
      expect(() =>
        service.assertStatusTransition(
          OfferStatusEnum.SCHEDULED,
          OfferStatusEnum.CANCELLED,
        ),
      ).not.toThrow();
    });

    it('rejects an illegal transition (active -> scheduled)', () => {
      expect(() =>
        service.assertStatusTransition(
          OfferStatusEnum.ACTIVE,
          OfferStatusEnum.SCHEDULED,
        ),
      ).toThrow(BadRequestException);
    });

    it('rejects any transition out of a terminal status', () => {
      expect(() =>
        service.assertStatusTransition(
          OfferStatusEnum.EXPIRED,
          OfferStatusEnum.ACTIVE,
        ),
      ).toThrow(BadRequestException);
      expect(() =>
        service.assertStatusTransition(
          OfferStatusEnum.CANCELLED,
          OfferStatusEnum.ACTIVE,
        ),
      ).toThrow(BadRequestException);
    });

    it('treats a same-status transition as a no-op', () => {
      expect(() =>
        service.assertStatusTransition(
          OfferStatusEnum.ACTIVE,
          OfferStatusEnum.ACTIVE,
        ),
      ).not.toThrow();
    });
  });

  describe('deriveStatus', () => {
    it('derives active when startDate is in the past', () => {
      const now = new Date('2999-06-15T12:00:00.000Z');
      expect(
        service.deriveStatus(new Date('2999-06-15T10:00:00.000Z'), now),
      ).toBe(OfferStatusEnum.ACTIVE);
      expect(
        service.deriveStatus(new Date('2999-06-01T00:00:00.000Z'), now),
      ).toBe(OfferStatusEnum.ACTIVE);
    });

    it('derives scheduled when startDate is later today or in the future', () => {
      const now = new Date('2999-06-15T12:00:00.000Z');
      // Later today:
      expect(
        service.deriveStatus(new Date('2999-06-15T15:00:00.000Z'), now),
      ).toBe(OfferStatusEnum.SCHEDULED);
      // Future date:
      expect(
        service.deriveStatus(new Date('2999-07-01T00:00:00.000Z'), now),
      ).toBe(OfferStatusEnum.SCHEDULED);
    });
  });
});
