import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { GenderEnum, RolesEnum } from 'src/Common/Types';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(20)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(20)
  lastName!: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsNotEmpty()
  @IsEnum(RolesEnum)
  role!: RolesEnum;

  @IsNotEmpty()
  @IsEnum(GenderEnum)
  gender!: GenderEnum;

  @IsNotEmpty()
  @IsDate()
  @Type(() => Date)
  DOB!: Date;

  @IsOptional()
  @IsMongoId()
  restaurantId?: string;
}
