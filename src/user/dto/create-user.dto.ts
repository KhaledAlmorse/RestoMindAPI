import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
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

  @IsPhoneNumber()
  @IsNotEmpty()
  phone!: string;

  @IsOptional()
  @IsEnum(RolesEnum)
  role?: string;

  @IsOptional()
  @IsEnum(GenderEnum)
  gender?: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  DOB?: Date;
}
