import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { MerchantAdjustment, MerchantAdjustmentType } from '../Models/merchant-adjustment.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class MerchantAdjustmentRepository extends BaseService<MerchantAdjustmentType> {
  constructor(
    @InjectModel(MerchantAdjustment.name)
    private readonly merchantAdjustmentModel: Model<MerchantAdjustmentType>,
  ) {
    super(merchantAdjustmentModel);
  }
}
