import {
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { IngredientUnitEnum, WasteReasonEnum } from 'src/Common/Types';

export class CreateWasteEventDto {
  @IsMongoId()
  @IsNotEmpty()
  ingredientId!: string;

  @IsMongoId()
  @IsOptional()
  batchId?: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsEnum(IngredientUnitEnum)
  @IsNotEmpty()
  unit!: IngredientUnitEnum;

  @IsEnum(WasteReasonEnum)
  @IsNotEmpty()
  wasteReason!: WasteReasonEnum;

  @IsNumber()
  @Min(0)
  estimatedCost!: number;

  @IsDateString()
  @IsOptional()
  date?: string;
}
