import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Refund, RefundType } from '../Models/refund.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class RefundRepository extends BaseService<RefundType> {
  constructor(
    @InjectModel(Refund.name)
    private readonly refundModel: Model<RefundType>,
  ) {
    super(refundModel);
  }
}
