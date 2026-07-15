import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import {
  OtpRepository,
  RevokeTokenRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { UserModel } from '../DB/Models/user.model';
import { TokenService } from 'src/Common/Services';
import { JwtService } from '@nestjs/jwt';
import { OtpModel } from 'src/DB/Models/otp.model';
import { RevokeTokenModel } from 'src/DB/Models';

@Module({
  imports: [UserModel, OtpModel, RevokeTokenModel],
  controllers: [AuthController],
  providers: [
    AuthService,
    UserRepository,
    TokenService,
    JwtService,
    OtpRepository,
    RevokeTokenRepository,
  ],
})
export class AuthModule {}
