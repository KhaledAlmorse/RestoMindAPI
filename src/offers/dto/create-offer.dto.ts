import {
  IsMongoId,
  IsNumber,
  IsDateString,
  IsOptional,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';

export class CreateOfferDto {
  @IsMongoId()
  productId!: string;

  @IsNumber()
  @Min(1)
  @Max(100)
  discountPercentage!: number;

  @IsDateString(
    {},
    { message: 'startDate must be a valid date (YYYY-MM-DD or ISO string)' },
  )
  startDate!: string;

  @IsDateString(
    {},
    { message: 'endDate must be a valid date (YYYY-MM-DD or ISO string)' },
  )
  endDate!: string;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}
