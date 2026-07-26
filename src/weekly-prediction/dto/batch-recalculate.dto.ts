import { IsOptional, IsString, Matches } from 'class-validator';

export class BatchRecalculateDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'targetWeek must be in YYYY-MM-DD format',
  })
  targetWeek?: string;
}
