import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { RiskLevelEnum } from 'src/Common/Types';

export class QueryWasteReportDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsEnum(RiskLevelEnum)
  riskLevel?: RiskLevelEnum;

  @IsOptional()
  @IsString()
  ingredientId?: string;
}
