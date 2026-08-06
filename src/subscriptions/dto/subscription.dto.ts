import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { PaymentMethodEnum } from 'src/Common/Types';

export class StartCheckoutDto {
  @IsEnum(['basic', 'plus', 'scale'])
  tier!: 'basic' | 'plus' | 'scale';

  @IsEnum(PaymentMethodEnum)
  method!: PaymentMethodEnum;
}

export class SetTrialDto {
  /** Null or a past date revokes the trial immediately. */
  @IsOptional()
  @IsDateString()
  trialEndsAt?: string | null;
}

export class SetEarlyBirdDto {
  /** False revokes the seat; the merchant renews at the standard price. */
  @IsBoolean()
  granted!: boolean;
}
