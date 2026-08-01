import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BusinessTypeEnum } from 'src/Common/Types';

export class CreatePartnershipApplicationDto {
  @IsString()
  @IsNotEmpty()
  businessName!: string;

  @IsEnum(BusinessTypeEnum)
  @IsNotEmpty()
  businessType!: BusinessTypeEnum;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedOrdersPerDay?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedWasteKgPerDay?: number;

  @IsString()
  @IsNotEmpty()
  ownerFirstName!: string;

  @IsString()
  @IsNotEmpty()
  ownerLastName!: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsString()
  @IsOptional()
  district?: string;

  @IsString()
  @IsOptional()
  street?: string;

  @IsString()
  @IsOptional()
  website?: string;

  @IsString()
  @IsOptional()
  facebookPage?: string;

  @IsString()
  @IsOptional()
  instagramPage?: string;

  @IsObject()
  @IsOptional()
  operatingHours?: Record<string, any>;

  @IsString()
  @IsOptional()
  commercialRegistration?: string;

  @IsString()
  @IsOptional()
  taxId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
