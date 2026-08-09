import { IsString, IsNotEmpty, IsBoolean, IsOptional, IsObject } from 'class-validator';

export class ActionApprovalDto {
  @IsString()
  @IsOptional()
  recommendationActionId?: string;

  // Not trusted for execution: the server executes only the toolName/arguments
  // sealed inside `approvalToken`. Kept here only so the client can echo back
  // what it thinks it's approving; ApprovalService ignores these values.
  @IsString()
  @IsOptional()
  toolName?: string;

  @IsObject()
  @IsOptional()
  arguments?: Record<string, any>;

  @IsString()
  @IsNotEmpty()
  approvalToken!: string;

  @IsBoolean()
  @IsNotEmpty()
  approved!: boolean;

  @IsString()
  @IsOptional()
  sessionId?: string;
}
