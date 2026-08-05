import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRefundDto {
  /** Omit to refund the whole group. */
  @IsOptional()
  @IsMongoId()
  orderId?: string;

  /** Omit to refund the whole order. Indexes into Order.items. */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(0, { each: true })
  lineItemIndexes?: number[];

  @IsString()
  @MinLength(3)
  reason!: string;
}

export class ReviewRefundDto {
  @IsEnum(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
