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

  @ValidateIf((o) => o.role !== RolesEnum.STAFF)
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password?: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsNotEmpty()
  @IsEnum(RolesEnum)
  role!: RolesEnum;

  @IsOptional()
  @IsEnum(GenderEnum)
  gender?: GenderEnum;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  DOB?: Date;

  @IsOptional()
  @IsMongoId()
  restaurantId?: string;

  @IsOptional()
  @IsString()
  employeeCode?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  hireDate?: Date;

  @IsOptional()
  @IsEnum(['active', 'inactive', 'terminated'])
  employmentStatus?: 'active' | 'inactive' | 'terminated';

  @IsOptional()
  @IsString()
  notes?: string;
}
