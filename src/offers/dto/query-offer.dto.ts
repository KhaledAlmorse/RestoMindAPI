import { IsOptional, IsEnum, IsMongoId, IsString } from 'class-validator';
import { OfferStatusEnum, OfferSourceEnum } from 'src/Common/Types';

export class QueryOfferDto {
  @IsOptional()
  @IsEnum(OfferStatusEnum)
  status?: OfferStatusEnum;

  @IsOptional()
  @IsMongoId()
  productId?: string;

  @IsOptional()
  @IsEnum(OfferSourceEnum)
  source?: OfferSourceEnum;

  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @IsOptional()
  @IsMongoId()
  restaurantId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  featured?: string;

  @IsOptional()
  @IsString()
  minPrice?: string;

  @IsOptional()
  @IsString()
  maxPrice?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortOrder?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
