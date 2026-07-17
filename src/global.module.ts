import { Global, Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenService, UploadCloudFileService } from 'src/Common/Services';
import { RevokeTokenModel, UserModel } from 'src/DB/Models';
import { RevokeTokenRepository, UserRepository } from 'src/DB/Repositories';

@Global()
@Module({
  imports: [UserModel, RevokeTokenModel],
  providers: [
    UserRepository,
    RevokeTokenRepository,
    TokenService,
    JwtService,
    UploadCloudFileService,
  ],
  exports: [
    UserModel,
    RevokeTokenModel,
    UserRepository,
    RevokeTokenRepository,
    TokenService,
    JwtService,
    UploadCloudFileService,
  ],
})
export class GlobalAuthModule {}
