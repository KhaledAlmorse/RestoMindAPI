import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/** Every field optional: an admin flipping one switch sends only that switch. */
export class UpdateSystemSettingsDto {
  @IsOptional()
  @IsBoolean()
  freeTrialEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  trialDurationDays?: number;

  @IsOptional()
  @IsBoolean()
  earlyBirdEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  earlyBirdCap?: number;

  /** @IsNumber, not @IsInt: the rate carries decimals (33.3333). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  earlyBirdDiscountPercent?: number;

  /** A fraction, not a percent: 0.05 is 5%. Matches the Restaurant field. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  defaultCommissionRate?: number;
}
