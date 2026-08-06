import { Global, Module } from '@nestjs/common';
import { RestaurantModel, SystemSettingsModel } from 'src/DB/Models';
import {
  RestaurantRepository,
  SystemSettingsRepository,
} from 'src/DB/Repositories';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsService } from './system-settings.service';

/**
 * @Global because the switches are read at two unrelated points — merchant
 * onboarding and subscription checkout — and neither module has any other
 * reason to know this one exists. Same shape as PaymentsModule.
 */
@Global()
@Module({
  imports: [SystemSettingsModel, RestaurantModel],
  controllers: [SystemSettingsController],
  providers: [
    SystemSettingsRepository,
    RestaurantRepository,
    SystemSettingsService,
  ],
  exports: [SystemSettingsService],
})
export class SystemSettingsModule {}
