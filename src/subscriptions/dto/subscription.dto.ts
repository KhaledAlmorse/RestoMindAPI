import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { PaymentMethodEnum } from 'src/Common/Types';
import { BillingInterval } from '../billing-interval';

export class StartCheckoutDto {
  /** A plan slug. No enum — plans are admin-managed and slugs are open-ended. */
  @IsString()
  @IsNotEmpty()
  tier!: string;

  @IsEnum(['monthly', 'halfYearly', 'yearly'])
  interval!: BillingInterval;

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
