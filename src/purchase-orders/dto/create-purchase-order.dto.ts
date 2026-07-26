import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { IngredientUnitEnum, PurchaseOrderStatusEnum } from 'src/Common/Types';

export class CreatePurchaseOrderItemDto {
  @IsMongoId()
  @IsNotEmpty()
  ingredientId!: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsEnum(IngredientUnitEnum)
  @IsNotEmpty()
  unit!: IngredientUnitEnum;

  @IsNumber()
  @Min(0)
  unitCost!: number;
}

export class CreatePurchaseOrderDto {
  @IsMongoId()
  @IsNotEmpty()
  supplierId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderItemDto)
  items!: CreatePurchaseOrderItemDto[];

  @IsEnum(PurchaseOrderStatusEnum)
  @IsOptional()
  status?: PurchaseOrderStatusEnum;

  @IsDateString()
  @IsOptional()
  expectedDeliveryDate?: string;
}
