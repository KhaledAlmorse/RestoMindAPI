import { IsOptional, IsString, IsMongoId } from 'class-validator';

export class QueryOfferDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsMongoId()
  productId?: string;

  @IsOptional()
  @IsString()
  source?: string;
}
