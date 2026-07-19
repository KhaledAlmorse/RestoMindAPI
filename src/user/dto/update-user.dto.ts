import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { GenderEnum, RolesEnum } from 'src/Common/Types';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  lastName?: string;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  @IsOptional()
  @IsEnum(GenderEnum)
  gender?: GenderEnum;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  DOB?: Date;

  @IsOptional()
  @IsEnum(RolesEnum)
  role?: RolesEnum;

  @IsOptional()
  @IsMongoId()
  restaurantId?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
