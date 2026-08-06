import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { type IAuthUser } from 'src/Common/Types';
import { UpdateSystemSettingsDto } from './dto/system-settings.dto';
import { SystemSettingsService } from './system-settings.service';

@Controller('admin/settings')
export class SystemSettingsController {
  constructor(private readonly systemSettingsService: SystemSettingsService) {}

  @Get()
  @Auth('admin')
  get() {
    return this.systemSettingsService.getWithUsage();
  }

  @Patch()
  @Auth('admin')
  update(@Body() body: UpdateSystemSettingsDto, @AuthUser() user: IAuthUser) {
    return this.systemSettingsService.update(body, user.user._id.toString());
  }
}
