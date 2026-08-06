import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

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
}
