import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { OfferRepository } from 'src/DB/Repositories';
import { OfferType } from 'src/DB/Models/offer.model';
import { OfferStatusEnum } from 'src/Common/Types';

@Injectable()
export class OfferRulesService {
  readonly LIVE_STATUSES = [
    OfferStatusEnum.DRAFT,
    OfferStatusEnum.SCHEDULED,
    OfferStatusEnum.ACTIVE,
    OfferStatusEnum.SOLD_OUT,
  ];

  private readonly STATUS_TRANSITIONS: Record<
    OfferStatusEnum,
    OfferStatusEnum[]
  > = {
    [OfferStatusEnum.DRAFT]: [
      OfferStatusEnum.SCHEDULED,
      OfferStatusEnum.ACTIVE,
      OfferStatusEnum.CANCELLED,
    ],
    [OfferStatusEnum.SCHEDULED]: [
      OfferStatusEnum.ACTIVE,
      OfferStatusEnum.CANCELLED,
    ],
    [OfferStatusEnum.ACTIVE]: [
      OfferStatusEnum.SOLD_OUT,
      OfferStatusEnum.EXPIRED,
      OfferStatusEnum.CANCELLED,
    ],
    [OfferStatusEnum.SOLD_OUT]: [
      OfferStatusEnum.ACTIVE,
      OfferStatusEnum.EXPIRED,
      OfferStatusEnum.CANCELLED,
    ],
    [OfferStatusEnum.EXPIRED]: [],
    [OfferStatusEnum.CANCELLED]: [],
  };

  constructor(private readonly offerRepository: OfferRepository) {}

  /**
   * Every live status (draft/scheduled/active/sold_out) occupies its time
   * window — a sold_out offer can still be restocked back to active, so it
   * keeps blocking the slot until its endDate passes.
   */
  async assertNoOverlap(
    productId: string,
    startDate: Date,
    endDate: Date,
    excludeOfferId?: string,
  ) {
    const filters: Record<string, any> = {
      productId: new Types.ObjectId(productId),
      status: { $in: this.LIVE_STATUSES },
      isDeleted: false,
      startDate: { $lte: endDate },
      endDate: { $gte: startDate },
    };
    if (excludeOfferId) {
      filters._id = { $ne: new Types.ObjectId(excludeOfferId) };
    }
    const existing = await this.offerRepository.findOne({ filters });
    if (existing) {
      const from = existing.startDate.toISOString().split('T')[0];
      const to = existing.endDate.toISOString().split('T')[0];
      throw new ConflictException(
        `This product already has an offer (status: ${existing.status}) covering ${from} to ${to}`,
      );
    }
  }

  /** Returns the conflicting active offer for the product, if any. */
  async assertActiveConflict(
    productId: string,
    excludeOfferId?: string,
  ): Promise<OfferType | null> {
    const filters: Record<string, any> = {
      productId: new Types.ObjectId(productId),
      status: OfferStatusEnum.ACTIVE,
      isDeleted: false,
    };
    if (excludeOfferId) {
      filters._id = { $ne: new Types.ObjectId(excludeOfferId) };
    }
    return this.offerRepository.findOne({ filters });
  }

  assertStatusTransition(from: OfferStatusEnum, to: OfferStatusEnum) {
    if (from === to) return;
    const allowed = this.STATUS_TRANSITIONS[from] || [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Cannot change offer status from "${from}" to "${to}"`,
      );
    }
  }

  deriveStatus(startDate: Date, now: Date): OfferStatusEnum {
    return startDate <= now
      ? OfferStatusEnum.ACTIVE
      : OfferStatusEnum.SCHEDULED;
  }
}
