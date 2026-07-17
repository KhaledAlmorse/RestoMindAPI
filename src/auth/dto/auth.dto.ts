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
import { GenderEnum, OtpTypeEnum, RolesEnum } from 'src/Common/Types';

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

// ─── New DTOs ───────────────────────────────────────────────────────────────

export class SendOtpDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsEnum(OtpTypeEnum)
  @IsNotEmpty()
  type!: OtpTypeEnum;
}

export class ForgetPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  confirmPassword!: string;
}

export class UpdateMeDto {
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
  gender?: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  DOB?: Date;
}

export class UpdatePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  oldPassword!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  confirmPassword!: string;
}

export class ConfirmResetOtpDto {
  @IsString()
  @IsNotEmpty()
  otp!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
