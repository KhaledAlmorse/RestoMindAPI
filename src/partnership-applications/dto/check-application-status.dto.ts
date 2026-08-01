import { IsEmail, IsNotEmpty } from 'class-validator';

export class CheckApplicationStatusDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
