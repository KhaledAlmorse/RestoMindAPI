import { IsMongoId, IsOptional, IsString, Matches } from 'class-validator';

export class RecalculatePredictionDto {
  @IsMongoId()
  productId!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'targetWeek must be in YYYY-MM-DD format',
  })
  targetWeek?: string;
}
