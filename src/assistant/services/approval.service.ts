import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { AssistantActionLogRepository, RecommendationActionRepository } from 'src/DB/Repositories';
import { ToolExecutorService } from './tool-executor.service';
import { ToolContext } from '../tools/tool-registry.service';
import { ActionApprovalToken } from './action-approval-token';
import { Types } from 'mongoose';

export interface ActionApprovalRequest {
  recommendationActionId?: string;
  approvalToken: string;
  approved: boolean; // true = Approve, false = Reject
}

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly actionLogRepo: AssistantActionLogRepository,
    private readonly recommendationActionRepo: RecommendationActionRepository,
    private readonly toolExecutor: ToolExecutorService,
  ) {}

  async processActionApproval(request: ActionApprovalRequest, context: ToolContext) {
    const { recommendationActionId, approved } = request;
    const { restaurantId, userId, sessionId } = context;

    // The approval token is the only source of truth for WHAT gets executed.
    // It was signed server-side when this action/recommendation was proposed,
    // so a client can't approve one action while sneaking a different
    // toolName or arguments (e.g. a bigger discount, a different recipient)
    // into this request.
    const verified = ActionApprovalToken.verify(request.approvalToken, restaurantId);
    if (!verified) {
      throw new BadRequestException(
        'Invalid or expired approval token. Please re-request this action from the assistant.',
      );
    }
    const { toolName, arguments: toolArgs } = verified;

    this.logger.log(
      `Processing Human Approval for tool [${toolName}] by user [${userId}]: Approved=${approved}`,
    );

    if (!approved) {
      // User Rejected the action
      if (recommendationActionId) {
        await this.recommendationActionRepo.update({
          filters: { _id: new Types.ObjectId(recommendationActionId), restaurantId } as any,
          body: { status: 'REJECTED', actedBy: userId, executedAt: new Date() },
        });
      }

      await this.actionLogRepo.create({
        restaurantId,
        userId,
        sessionId,
        toolName,
        arguments: toolArgs,
        executionStatus: 'REJECTED_BY_USER',
        durationMs: 0,
        modelUsed: 'human-approval-guard',
        errorMessage: 'User explicitly rejected the proposed action in UI.',
      });

      return {
        status: 'REJECTED_BY_USER',
        message: `Action [${toolName}] was cancelled by user.`,
      };
    }

    // User Approved the action -> Execute tool
    const startTime = Date.now();
    try {
      const results = await this.toolExecutor.executePlanSteps(
        [{ toolName, arguments: toolArgs, reason: 'Human user approved execution' }],
        context,
        true, // allowActionExecution = true
      );

      const durationMs = Date.now() - startTime;
      const executionResult = results[0]?.result;

      // Update recommendation_actions if linked
      if (recommendationActionId) {
        await this.recommendationActionRepo.update({
          filters: { _id: new Types.ObjectId(recommendationActionId), restaurantId } as any,
          body: {
            status: 'EXECUTED',
            selectedByUser: true,
            actedBy: userId,
            executedAt: new Date(),
            executionResult,
          },
        });
      }

      // Write Audit Log
      await this.actionLogRepo.create({
        restaurantId,
        userId,
        sessionId,
        toolName,
        arguments: toolArgs,
        executionStatus: 'SUCCESS',
        durationMs,
        modelUsed: process.env.BEDROCK_PRIMARY_LLM || 'anthropic.claude-sonnet-4-6',
        executionResult,
      });

      return {
        status: 'SUCCESS',
        message: `Successfully executed action [${toolName}].`,
        result: executionResult,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      if (recommendationActionId) {
        await this.recommendationActionRepo.update({
          filters: { _id: new Types.ObjectId(recommendationActionId), restaurantId } as any,
          body: { status: 'FAILED', actedBy: userId, executedAt: new Date() },
        });
      }

      await this.actionLogRepo.create({
        restaurantId,
        userId,
        sessionId,
        toolName,
        arguments: toolArgs,
        executionStatus: 'FAILED',
        durationMs,
        modelUsed: process.env.BEDROCK_PRIMARY_LLM || 'anthropic.claude-sonnet-4-6',
        errorMessage: error?.message || 'Execution error',
      });

      throw error;
    }
  }
}
