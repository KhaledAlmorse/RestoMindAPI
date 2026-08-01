import { Module } from '@nestjs/common';
import { PartnershipApplicationsController } from './partnership-applications.controller';
import { PartnershipApplicationsService } from './partnership-applications.service';
import {
  PartnershipApplicationRepository,
  RestaurantRepository,
  RevokeTokenRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { PartnershipApplicationModel } from 'src/DB/Models/partnership-application.model';
import { UserModel } from 'src/DB/Models/user.model';
import { RestaurantModel } from 'src/DB/Models/restaurant.model';
import { RevokeTokenModel } from 'src/DB/Models/revoked-token.model';
import { TokenService } from 'src/Common/Services';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [
    PartnershipApplicationModel,
    UserModel,
    RestaurantModel,
    RevokeTokenModel,
  ],
  controllers: [PartnershipApplicationsController],
  providers: [
    PartnershipApplicationsService,
    PartnershipApplicationRepository,
    UserRepository,
    RestaurantRepository,
    RevokeTokenRepository,
    TokenService,
    JwtService,
  ],
  exports: [PartnershipApplicationsService],
})
export class PartnershipApplicationsModule {}
