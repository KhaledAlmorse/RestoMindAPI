import { Injectable, Logger } from '@nestjs/common';
import { z, ZodSchema } from 'zod';
import { Types } from 'mongoose';
import { redactSecrets } from 'src/Common/Utils/redact-secrets.util';

export interface ToolContext {
  restaurantId: Types.ObjectId;
  userId: Types.ObjectId;
  sessionId: string;
}

export interface RegisteredTool {
  name: string;
  description: string;
  schema: ZodSchema<any>;
  requiresApproval: boolean;
  handler: (params: any, context: ToolContext) => Promise<any>;
}

export function AgentTool(metadata: {
  name: string;
  description: string;
  schema: ZodSchema<any>;
  requiresApproval?: boolean;
}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    Reflect.defineMetadata(
      'agent:tool',
      {
        name: metadata.name,
        description: metadata.description,
        schema: metadata.schema,
        requiresApproval: metadata.requiresApproval || false,
        handlerName: propertyKey,
      },
      target,
      propertyKey,
    );
    return descriptor;
  };
}

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, RegisteredTool>();

  registerTool(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
    this.logger.log(`Registered Agent Tool: [${tool.name}] (Requires Approval: ${tool.requiresApproval})`);
  }

  getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  getToolDefinitionsForLLM() {
    return this.getAllTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: this.zodToJsonSchema(tool.schema),
      requiresApproval: tool.requiresApproval,
    }));
  }

  async executeTool(name: string, params: any, context: ToolContext): Promise<any> {
    const tool = this.getTool(name);
    if (!tool) {
      throw new Error(`Tool [${name}] is not registered in ToolRegistryService.`);
    }

    // Validate parameters against Zod schema
    const parseResult = tool.schema.safeParse(params);
    if (!parseResult.success) {
      throw new Error(`Invalid parameters for tool [${name}]: ${parseResult.error.message}`);
    }

    this.logger.log(`Executing Tool [${name}] for restaurant [${context.restaurantId}]...`);
    const startTime = Date.now();

    try {
      const result = await tool.handler(parseResult.data, context);
      const durationMs = Date.now() - startTime;
      this.logger.log(`[AUDIT] Completed Tool [${name}] for restaurant [${context.restaurantId}] in ${durationMs}ms`);
      return result;
    } catch (error: any) {
      const rawMsg = error?.message || String(error);
      const safeMsg = redactSecrets(rawMsg);
      this.logger.error(`[AUDIT] Error executing Tool [${name}] for restaurant [${context.restaurantId}]: ${safeMsg}`);
      throw new Error(`Execution of tool [${name}] failed: ${safeMsg}`);
    }
  }

  private zodToJsonSchema(schema: ZodSchema<any>): any {
    // Basic Zod schema serialization to JSON schema representation for LLM function calling
    try {
      return (schema as any)._def ? { type: 'object' } : {};
    } catch {
      return { type: 'object' };
    }
  }
}
