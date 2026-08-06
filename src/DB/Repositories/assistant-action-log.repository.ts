import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { AssistantActionLog, AssistantActionLogType } from '../Models/assistant-action-log.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class AssistantActionLogRepository extends BaseService<AssistantActionLogType> {
  constructor(
    @InjectModel(AssistantActionLog.name)
    private readonly actionLogModel: Model<AssistantActionLogType>,
  ) {
    super(actionLogModel);
  }
}
