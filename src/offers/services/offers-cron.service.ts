import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OfferRepository } from 'src/DB/Repositories';
import { OfferStatusEnum } from 'src/Common/Types';
import { OfferRulesService } from './offer-rules.service';

@Injectable()
export class OffersCronService implements OnModuleInit {
  constructor(
    private readonly offerRepository: OfferRepository,
    private readonly offerRulesService: OfferRulesService,
  ) {}

  async onModuleInit() {
    await this.processStatusTransitions();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processStatusTransitions() {
    const now = new Date();

    // 1. Expire: active or sold_out offers whose window has ended
    await this.offerRepository.updateMany(
      {
        status: { $in: [OfferStatusEnum.ACTIVE, OfferStatusEnum.SOLD_OUT] },
        endDate: { $lte: now },
        isDeleted: false,
      },
      { status: OfferStatusEnum.EXPIRED },
    );

    // 2. Demote: active offers whose window hasn't started yet (defensive)
    await this.offerRepository.updateMany(
      {
        status: OfferStatusEnum.ACTIVE,
        startDate: { $gt: now },
        isDeleted: false,
      },
      { status: OfferStatusEnum.SCHEDULED },
    );

    // 3. Promote: scheduled offers whose window has started — at most one
    // active offer per product, so a conflict just means "retry next tick"
    const readyToActivate = await this.offerRepository.findMany({
      filters: {
        status: OfferStatusEnum.SCHEDULED,
        startDate: { $lte: now },
        endDate: { $gt: now },
        isDeleted: false,
      },
    });

    for (const offer of readyToActivate || []) {
      const conflict = await this.offerRulesService.assertActiveConflict(
        offer.productId.toString(),
        offer._id.toString(),
      );
      if (conflict) continue;

      await this.offerRepository.update({
        filters: { _id: offer._id },
        body: { status: OfferStatusEnum.ACTIVE } as any,
      });
    }

    // 4a. Mark sold out when stock has run out
    await this.offerRepository.updateMany(
      {
        status: OfferStatusEnum.ACTIVE,
        remainingQuantity: { $lte: 0 },
        isDeleted: false,
      },
      { status: OfferStatusEnum.SOLD_OUT },
    );

    // 4b. Reactivate sold-out offers that were restocked (e.g. a race with
    // an order cancellation), respecting the one-active-per-product rule
    const restockCandidates = await this.offerRepository.findMany({
      filters: {
        status: OfferStatusEnum.SOLD_OUT,
        remainingQuantity: { $gt: 0 },
        startDate: { $lte: now },
        endDate: { $gt: now },
        isDeleted: false,
      },
    });

    for (const offer of restockCandidates || []) {
      const conflict = await this.offerRulesService.assertActiveConflict(
        offer.productId.toString(),
        offer._id.toString(),
      );
      if (conflict) continue;

      await this.offerRepository.update({
        filters: { _id: offer._id },
        body: { status: OfferStatusEnum.ACTIVE } as any,
      });
    }
  }
}
