import { Type } from 'class-transformer';
import {
  IsArray,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class ActualItemDto {
  @IsMongoId()
  productId!: string;

  @IsNumber()
  @Min(0)
  actualProducedQty!: number;
}

export class RecordActualsDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be in YYYY-MM-DD format',
  })
  date?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActualItemDto)
  items!: ActualItemDto[];
}
