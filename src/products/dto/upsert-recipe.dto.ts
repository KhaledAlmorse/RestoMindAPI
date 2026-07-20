import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IngredientUnitEnum } from 'src/Common/Types';

export class RecipeIngredientItemDto {
  @IsMongoId()
  @IsNotEmpty()
  ingredientId!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  quantityPerPortion!: number;

  @IsEnum(IngredientUnitEnum)
  @IsNotEmpty()
  unit!: IngredientUnitEnum;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  yieldPercentage?: number;
}

export class UpsertRecipeDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientItemDto)
  ingredients!: RecipeIngredientItemDto[];
}
