import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { RecommendationAction, RecommendationActionType } from '../Models/recommendation-action.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class RecommendationActionRepository extends BaseService<RecommendationActionType> {
  constructor(
    @InjectModel(RecommendationAction.name)
    private readonly recommendationActionModel: Model<RecommendationActionType>,
  ) {
    super(recommendationActionModel);
  }
}
