import {
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import {
  IngredientUnitEnum,
  StockTransactionTypeEnum,
  WasteReasonEnum,
} from 'src/Common/Types';

export class CreateStockTransactionDto {
  @IsMongoId()
  @IsNotEmpty()
  ingredientId!: string;

  @IsMongoId()
  @IsOptional()
  batchId?: string;

  @IsEnum(StockTransactionTypeEnum)
  @IsNotEmpty()
  transactionType!: StockTransactionTypeEnum;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsEnum(IngredientUnitEnum)
  @IsNotEmpty()
  unit!: IngredientUnitEnum;

  @IsDateString()
  @IsOptional()
  date?: string;

  @IsEnum(WasteReasonEnum)
  @IsOptional()
  wasteReason?: WasteReasonEnum;

  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedCost?: number;
}
