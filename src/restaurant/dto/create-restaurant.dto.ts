import {
  IsNotEmpty,
  IsString,
  IsMongoId,
  IsOptional,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class RestaurantAddressDto {
  @IsString()
  @IsOptional()
  street?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  country?: string;
}

export class CreateRestaurantDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsMongoId()
  @IsNotEmpty()
  ownerUserId!: string;

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
}
