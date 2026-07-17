import { IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductDiscountDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  discountedPrice?: number;
}
