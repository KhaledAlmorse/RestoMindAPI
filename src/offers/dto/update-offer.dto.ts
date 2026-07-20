import {
  IsMongoId,
  IsNumber,
  IsDateString,
  IsOptional,
  IsBoolean,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { OfferStatusEnum } from 'src/Common/Types';

export class UpdateOfferDto {
  @IsOptional()
  @IsMongoId()
  productId?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  discountPercentage?: number;

  @IsOptional()
  @IsDateString(
    {},
    { message: 'startDate must be a valid date (YYYY-MM-DD or ISO string)' },
  )
  startDate?: string;

  @IsOptional()
  @IsDateString(
    {},
    { message: 'endDate must be a valid date (YYYY-MM-DD or ISO string)' },
  )
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsEnum(OfferStatusEnum)
  status?: OfferStatusEnum;
}
