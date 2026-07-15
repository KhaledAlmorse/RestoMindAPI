import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsStrongPassword,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { GenderEnum, RolesEnum } from 'src/Common/Types';
export class singupBodyDto {
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
  //   @IsStrongPassword()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsEnum(RolesEnum)
  role!: string;

  @IsOptional()
  @IsPhoneNumber()
  phone: string;

  @IsOptional()
  @IsEnum(GenderEnum)
  gender: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  DOB: Date;
}

export class loginBodyDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  //   @IsStrongPassword()
  @MinLength(6)
  password!: string;
}

export class ConfirmEmailDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  otp: string;
}
