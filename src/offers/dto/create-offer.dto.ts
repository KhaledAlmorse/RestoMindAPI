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

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}
