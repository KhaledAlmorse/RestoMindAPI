import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IngredientUnitEnum } from 'src/Common/Types';

export class CreateIngredientDto {
  @IsString()
  @IsNotEmpty()
  ingredientCode!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(IngredientUnitEnum)
  @IsNotEmpty()
  unit!: IngredientUnitEnum;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  shelfLifeDays!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minimumStock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  safetyStock?: number;
}
