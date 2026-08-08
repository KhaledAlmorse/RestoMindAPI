import { Injectable, Logger } from '@nestjs/common';
import { ToolRegistryService, ToolContext } from '../tools/tool-registry.service';
import { PlannedStep } from './planner.service';

export interface ToolExecutionResult {
  toolName: string;
  arguments: Record<string, any>;
  result: any;
  durationMs: number;
  requiresApproval: boolean;
  executed: boolean;
}

@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  constructor(private readonly toolRegistry: ToolRegistryService) {}

  async executePlanSteps(
    steps: PlannedStep[],
    context: ToolContext,
    allowActionExecution = false,
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    const boundedSteps = (steps || []).slice(0, 5);

    for (const step of boundedSteps) {
      const tool = this.toolRegistry.getTool(step.toolName);

      if (!tool) {
        this.logger.warn(`[AUDIT] Step requested unknown tool [${step.toolName}] for restaurant [${context.restaurantId}]. Skipping.`);
        continue;
      }

      // If tool requires human approval and execution is not explicitly approved yet, mark as pending
      if (tool.requiresApproval && !allowActionExecution) {
        this.logger.log(
          `[AUDIT] Tool [${step.toolName}] requires approval for restaurant [${context.restaurantId}]. Execution blocked until user confirms in UI.`,
        );
        results.push({
          toolName: step.toolName,
          arguments: step.arguments,
          result: { status: 'PENDING_HUMAN_APPROVAL', message: 'Action requires explicit user confirmation in UI.' },
          durationMs: 0,
          requiresApproval: true,
          executed: false,
        });
        continue;
      }

      const startTime = Date.now();
      try {
        const output = await this.toolRegistry.executeTool(step.toolName, step.arguments, context);
        const durationMs = Date.now() - startTime;

        results.push({
          toolName: step.toolName,
          arguments: step.arguments,
          result: output,
          durationMs,
          requiresApproval: tool.requiresApproval,
          executed: true,
        });
      } catch (error: any) {
        results.push({
          toolName: step.toolName,
          arguments: step.arguments,
          result: { error: error?.message || 'Tool execution failed' },
          durationMs: Date.now() - startTime,
          requiresApproval: tool.requiresApproval,
          executed: false,
        });
      }
    }

    return results;
  }
}
