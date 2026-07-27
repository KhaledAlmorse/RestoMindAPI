import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import {
  RecommendationStatusEnum,
  RecommendationTypeEnum,
} from 'src/Common/Types';

export class QueryRecommendationDto {
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
  @IsEnum(RecommendationStatusEnum)
  status?: RecommendationStatusEnum;

  @IsOptional()
  @IsEnum(RecommendationTypeEnum)
  type?: RecommendationTypeEnum;

  @IsOptional()
  @IsString()
  productId?: string;
}
