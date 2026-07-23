import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

export class DashboardQueryDto {
  @ApiPropertyOptional({
    description:
      'Start date in ISO format (e.g. 2026-07-17 or 2026-07-17T00:00:00.000Z)',
    example: '2026-07-17',
  })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'End date in ISO format (e.g. 2026-07-23 or 2026-07-23T23:59:59.999Z)',
    example: '2026-07-23',
  })
  @IsOptional()
  @IsISO8601()
  endDate?: string;
}
