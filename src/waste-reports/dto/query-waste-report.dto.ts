import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
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
  @Max(100)
  limit?: number = 10;

  @IsOptional()
  @IsEnum(RiskLevelEnum)
  riskLevel?: RiskLevelEnum;

  @IsOptional()
  @IsMongoId()
  ingredientId?: string;
}
