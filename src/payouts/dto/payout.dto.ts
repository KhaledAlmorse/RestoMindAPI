import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  NotEquals,
} from 'class-validator';

const CAIRO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class RecordPayoutDto {
  /** Cairo calendar date, exclusive end of the period being settled. */
  @Matches(CAIRO_DATE, { message: 'cutoffDate must be YYYY-MM-DD' })
  cutoffDate!: string;

  /**
   * Required and checked against the statement. Re-entering the figure is a
   * deliberate confirmation step: it catches the case where the statement moved
   * between being read and being paid.
   */
  @IsInt()
  amountCents!: number;

  @IsOptional()
  @IsString()
  reference?: string;
}

export class CompletePayoutDto {
  @IsOptional()
  @IsString()
  reference?: string;

  /** Present means the transfer failed; the payout is marked FAILED. */
  @IsOptional()
  @IsString()
  failureReason?: string;
}

export class CreateAdjustmentDto {
  /** Signed piasters. Positive credits the merchant. */
  @IsInt()
  @NotEquals(0, { message: 'A zero adjustment records nothing' })
  amountCents!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @Matches(CAIRO_DATE, { message: 'effectiveAt must be YYYY-MM-DD' })
  effectiveAt?: string;
}
