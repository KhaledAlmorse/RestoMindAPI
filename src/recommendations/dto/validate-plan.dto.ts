import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class ValidatePlanDto {
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsInt()
  @Min(1)
  planned_quantity!: number;
}
