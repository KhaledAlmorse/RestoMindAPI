import {
  IsMongoId,
  IsNumber,
  IsDateString,
  IsOptional,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';

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
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}
