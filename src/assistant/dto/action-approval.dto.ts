import { IsString, IsNotEmpty, IsBoolean, IsOptional, IsObject } from 'class-validator';

export class ActionApprovalDto {
  @IsString()
  @IsOptional()
  recommendationActionId?: string;

  @IsString()
  @IsNotEmpty()
  toolName!: string;

  @IsObject()
  @IsNotEmpty()
  arguments!: Record<string, any>;

  @IsBoolean()
  @IsNotEmpty()
  approved!: boolean;

  @IsString()
  @IsOptional()
  sessionId?: string;
}
