import { IsMongoId, IsOptional, IsString, Matches } from 'class-validator';

export class QueryPredictionsDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'targetWeek must be in YYYY-MM-DD format',
  })
  targetWeek?: string;

  @IsOptional()
  @IsMongoId()
  productId?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
