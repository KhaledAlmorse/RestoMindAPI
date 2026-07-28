import {
  IsString,
  IsMongoId,
  IsOptional,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { RestaurantAddressDto } from './create-restaurant.dto';

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
}
