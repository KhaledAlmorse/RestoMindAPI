import { IsNumber, IsOptional, Min, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductDiscountDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  discountedPrice?: number;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
