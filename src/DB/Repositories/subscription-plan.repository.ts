import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseService } from '../base.service';
import {
  SubscriptionPlan,
  SubscriptionPlanType,
} from '../Models/subscription-plan.model';

@Injectable()
export class SubscriptionPlanRepository extends BaseService<SubscriptionPlanType> {
  constructor(
    @InjectModel(SubscriptionPlan.name)
    private readonly subscriptionPlanModel: Model<SubscriptionPlanType>,
  ) {
    super(subscriptionPlanModel);
  }
}
