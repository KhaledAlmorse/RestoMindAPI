import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import {
  DailyProductionPlan,
  DailyProductionPlanType,
} from '../Models/daily-production-plan.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class DailyProductionPlanRepository extends BaseService<DailyProductionPlanType> {
  constructor(
    @InjectModel(DailyProductionPlan.name)
    private readonly dailyProductionPlanModel: Model<DailyProductionPlanType>,
  ) {
    super(dailyProductionPlanModel);
  }
}
