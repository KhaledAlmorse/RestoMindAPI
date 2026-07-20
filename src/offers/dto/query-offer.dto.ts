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
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
