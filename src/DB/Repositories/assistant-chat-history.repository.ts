import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { AssistantChatHistory, AssistantChatHistoryType } from '../Models/assistant-chat-history.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class AssistantChatHistoryRepository extends BaseService<AssistantChatHistoryType> {
  constructor(
    @InjectModel(AssistantChatHistory.name)
    private readonly chatHistoryModel: Model<AssistantChatHistoryType>,
  ) {
    super(chatHistoryModel);
  }
}
