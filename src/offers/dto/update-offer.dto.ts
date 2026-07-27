import {
  IsNumber,
  IsDateString,
  IsOptional,
  IsBoolean,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { OfferStatusEnum, OfferDiscountTypeEnum } from 'src/Common/Types';

export class UpdateOfferDto {
  @IsOptional()
  @IsEnum(OfferDiscountTypeEnum, {
    message: 'discountType must be a valid OfferDiscountTypeEnum',
  })
  discountType?: OfferDiscountTypeEnum;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  discountPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  offerPrice?: number;

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
  @IsNumber()
  @Min(1, { message: 'availableQuantity must be greater than zero' })
  availableQuantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxPerCustomer?: number;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsEnum(OfferStatusEnum)
  status?: OfferStatusEnum;
}
