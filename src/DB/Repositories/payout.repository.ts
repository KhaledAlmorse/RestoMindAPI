import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Payout, PayoutType } from '../Models/payout.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class PayoutRepository extends BaseService<PayoutType> {
  constructor(
    @InjectModel(Payout.name)
    private readonly payoutModel: Model<PayoutType>,
  ) {
    super(payoutModel);
  }
}
