import { Injectable, Logger } from '@nestjs/common';
import {
  RestaurantRepository,
  SystemSettingsRepository,
} from 'src/DB/Repositories';
import { SystemSettingsType } from 'src/DB/Models';
import { UpdateSystemSettingsDto } from './dto/system-settings.dto';

@Injectable()
export class SystemSettingsService {
  private readonly logger = new Logger(SystemSettingsService.name);

  constructor(
    private readonly systemSettingsRepository: SystemSettingsRepository,
    private readonly restaurantRepository: RestaurantRepository,
  ) {}

  /**
   * The one settings document, created on first read so a fresh database
   * behaves exactly like a seeded one. Every default lives in the schema, so
   * this never has to restate them and they can never drift apart.
   */
  async get(): Promise<SystemSettingsType> {
    const existing = await this.systemSettingsRepository.findOne({
      filters: { key: 'platform' },
    });
    if (existing) return existing;

    return await this.systemSettingsRepository.create({ key: 'platform' } as any);
  }

  /** The settings plus the numbers an admin needs to read them in context. */
  async getWithUsage() {
    const settings = await this.get();
    const earlyBirdClaimed = await this.countEarlyBirds();

    return {
      freeTrialEnabled: settings.freeTrialEnabled,
      trialDurationDays: settings.trialDurationDays,
      earlyBirdEnabled: settings.earlyBirdEnabled,
      earlyBirdCap: settings.earlyBirdCap,
      earlyBirdClaimed,
      earlyBirdSeatsLeft: Math.max(0, settings.earlyBirdCap - earlyBirdClaimed),
    };
  }

  /** How many merchants hold an early-bird seat, however they were granted it. */
  async countEarlyBirds(): Promise<number> {
    return await this.restaurantRepository.countDocuments({
      'subscription.earlyBird': true,
    });
  }

  async update(body: UpdateSystemSettingsDto, adminId: string) {
    const settings = await this.get();

    await this.systemSettingsRepository.update({
      filters: { _id: settings._id },
      body: body as any,
    });

    // Worth a line in the log: turning early-bird off reprices every existing
    // early bird at their next renewal, and turning trials off changes what
    // every new merchant lands on. Neither is visible in any other record.
    this.logger.log(
      `Admin ${adminId} updated system settings: ${JSON.stringify(body)}`,
    );

    return await this.getWithUsage();
  }
}
