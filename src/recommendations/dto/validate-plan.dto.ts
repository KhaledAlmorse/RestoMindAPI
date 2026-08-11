import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ValidatePlanDto {
  @ValidateIf((o) => !o.productId)
  @IsString()
  @IsNotEmpty()
  sku?: string;

  @ValidateIf((o) => !o.sku)
  @IsString()
  @IsNotEmpty()
  productId?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  planned_quantity!: number;
}
