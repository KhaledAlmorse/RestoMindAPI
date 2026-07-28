import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateBatchDto {
  @IsMongoId()
  @IsNotEmpty()
  ingredientId!: string;

  @IsString()
  @IsNotEmpty()
  batchNumber!: string;

  @IsNumber()
  @Min(0)
  quantityRemaining!: number;

  @IsNumber()
  @Min(0)
  unitCost!: number;

  @IsDateString()
  @IsNotEmpty()
  expiryDate!: string;

  @IsDateString()
  @IsOptional()
  receivedDate?: string;
}

export class CreateBatchesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateBatchDto)
  batches!: CreateBatchDto[];
}
