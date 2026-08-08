import {
  IsString,
  IsMongoId,
  IsOptional,
  ValidateNested,
  IsBoolean,
  IsNumber,
  IsInt,
  IsIn,
  IsNotEmpty,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { RestaurantAddressDto } from './create-restaurant.dto';

/**
 * Where a payout is transferred. Absent on the restaurant blocks payouts
 * entirely, so this is the only way a merchant ever becomes payable.
 */
export class PayoutDestinationDto {
  @IsIn(['bank', 'wallet'])
  method!: 'bank' | 'wallet';

  @IsString()
  @IsNotEmpty()
  accountName!: string;

  @IsString()
  @IsNotEmpty()
  accountNumber!: string;

  @IsOptional()
  @IsString()
  bankName?: string;
}

export class UpdateRestaurantDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsMongoId()
  @IsOptional()
  ownerUserId?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RestaurantAddressDto)
  address?: RestaurantAddressDto;

  @Transform(
    ({ value }) =>
      value === 'true' || value === true || value === 1 || value === '1',
  )
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /**
   * Closing time as a Cairo wall-clock hour, 0–23 (22 = 10pm).
   *
   * Feeds the AI surplus scan, which sizes an end-of-day discount from the
   * selling time left before closing. `null` clears it and restores the
   * platform default; like commissionRate it must survive the transform
   * untouched, since `Number(null)` is 0 — midnight — which would make every
   * surplus scan think the shop had already shut.
   */
  @Transform(({ value }) =>
    value === null || value === '' ? null : Number(value),
  )
  @IsInt()
  @Min(0)
  @Max(23)
  @IsOptional()
  closeHour?: number | null;

  /**
   * A fraction, not a percent: 0.05 is 5%. Same unit as
   * SystemSettings.defaultCommissionRate and Order.commissionRate, so nothing
   * on the server ever converts.
   *
   * `null` clears the override, dropping the merchant back to the platform
   * default. It must survive the transform untouched — `Number(null)` is 0,
   * which would silently put the merchant on 0% commission instead.
   *
   * Admin-only: the controller rejects it from a manager, who would otherwise
   * be able to zero their own commission.
   */
  // @IsOptional carries the null case: it skips every validator below when the
  // value is null or undefined, so the cleared override reaches the update as
  // null and Mongoose unsets the field.
  @Transform(({ value }) =>
    value === null || value === '' ? null : Number(value),
  )
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  commissionRate?: number | null;

  /**
   * Admin-only, same reason: it decides where the money is sent.
   *
   * Parsed leniently because this endpoint also accepts multipart, where a
   * nested object arrives as a string. A malformed one is passed through as-is
   * so @ValidateNested answers with a 400 rather than a JSON.parse 500.
   */
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PayoutDestinationDto)
  payoutDestination?: PayoutDestinationDto;
}
