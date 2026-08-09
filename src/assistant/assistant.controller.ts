import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { Auth, AuthUser, AiThrottle } from 'src/Common/Decorators';
import { IAuthUser } from 'src/Common/Types';
import { AssistantService } from './services/assistant.service';
import { ApprovalService } from './services/approval.service';
import { VectorStoreService } from 'src/vector-store/vector-store.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ActionApprovalDto } from './dto/action-approval.dto';
import { Types } from 'mongoose';

@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly assistantService: AssistantService,
    private readonly approvalService: ApprovalService,
    private readonly vectorStoreService: VectorStoreService,
  ) { }

  @Post('chat')
  @Auth('admin', 'manager', 'staff')
  @AiThrottle()
  async chat(
    @Body() body: ChatRequestDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const restaurantId = new Types.ObjectId(authUser.user.restaurantId);
    const userId = new Types.ObjectId(authUser.user._id);
    const sessionId = body.sessionId || `session_${userId.toString()}_${Date.now()}`;

    const result = await this.assistantService.processUserMessage(
      body.message,
      {
        restaurantId,
        userId,
        sessionId,
      },
    );

    res.status(HttpStatus.OK).json(result);
  }

  @Post('approve-action')
  @Auth('admin', 'manager')
  @AiThrottle()
  async approveAction(
    @Body() body: ActionApprovalDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const restaurantId = new Types.ObjectId(authUser.user.restaurantId);
    const userId = new Types.ObjectId(authUser.user._id);
    const sessionId = body.sessionId || `session_${userId.toString()}_${Date.now()}`;

    const result = await this.approvalService.processActionApproval(
      {
        recommendationActionId: body.recommendationActionId,
        approvalToken: body.approvalToken,
        approved: body.approved,
      },
      {
        restaurantId,
        userId,
        sessionId,
      },
    );

    res.status(HttpStatus.OK).json(result);
  }

  @Post('sync-vectors')
  @Auth('admin', 'manager')
  async syncVectors(
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const restaurantId = new Types.ObjectId(authUser.user.restaurantId);
    const result = await this.vectorStoreService.syncAllRestaurantVectors(restaurantId);

    res.status(HttpStatus.OK).json({
      success: true,
      message: `Successfully synced ${result.syncedCount} entity vectors for restaurant.`,
      ...result,
    });
  }

  @Get('sessions')
  @Auth('admin', 'manager', 'staff')
  async getUserSessions(
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const restaurantId = new Types.ObjectId(authUser.user.restaurantId);
    const userId = new Types.ObjectId(authUser.user._id);

    const result = await this.assistantService.getUserSessions(restaurantId, userId);
    res.status(HttpStatus.OK).json(result);
  }

  @Get('sessions/:sessionId')
  @Auth('admin', 'manager', 'staff')
  async getSessionHistory(
    @Param('sessionId') sessionId: string,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const restaurantId = new Types.ObjectId(authUser.user.restaurantId);
    const userId = new Types.ObjectId(authUser.user._id);

    const result = await this.assistantService.getSessionHistory(restaurantId, userId, sessionId);
    res.status(HttpStatus.OK).json(result);
  }

  @Delete('sessions/:sessionId')
  @Auth('admin', 'manager', 'staff')
  async deleteSession(
    @Param('sessionId') sessionId: string,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const restaurantId = new Types.ObjectId(authUser.user.restaurantId);
    const userId = new Types.ObjectId(authUser.user._id);

    const result = await this.assistantService.deleteSession(restaurantId, userId, sessionId);
    res.status(HttpStatus.OK).json(result);
  }
}
