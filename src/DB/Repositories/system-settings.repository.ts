import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import {
  SystemSettings,
  SystemSettingsType,
} from '../Models/system-settings.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class SystemSettingsRepository extends BaseService<SystemSettingsType> {
  constructor(
    @InjectModel(SystemSettings.name)
    private readonly systemSettingsModel: Model<SystemSettingsType>,
  ) {
    super(systemSettingsModel);
  }
}
