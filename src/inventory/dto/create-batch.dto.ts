import {
  IsDateString,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
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
