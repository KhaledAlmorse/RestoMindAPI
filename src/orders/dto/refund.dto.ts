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
  /**
   * `settle` closes out a refund the gateway could not take (cash on delivery,
   * a wallet that does not support refunds) once a human has handed the money
   * back. Without it those refunds are a dead end and the order never moves.
   */
  @IsEnum(['approve', 'reject', 'settle'])
  decision!: 'approve' | 'reject' | 'settle';

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
