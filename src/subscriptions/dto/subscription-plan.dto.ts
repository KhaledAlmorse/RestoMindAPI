import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Prices in integer EGP cents. Omitting a field leaves it untouched on an
 * update; sending an explicit null withdraws that interval from sale.
 */
export class PlanPricesDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  monthly?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  halfYearly?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  yearly?: number | null;
}

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase kebab-case',
  })
  slug!: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  /** Omit or send null for unlimited. */
  @IsOptional()
  @IsInt()
  @Min(1)
  productCap?: number | null;

  @ValidateNested()
  @Type(() => PlanPricesDto)
  prices!: PlanPricesDto;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isTrialPlan?: boolean;
}

/** `slug` is accepted only so the service can reject it with a clear message. */
export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  productCap?: number | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => PlanPricesDto)
  prices?: PlanPricesDto;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isTrialPlan?: boolean;
}

export class SetPlanArchivedDto {
  @IsBoolean()
  archived!: boolean;
}
