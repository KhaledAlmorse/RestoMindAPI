import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RestaurantRepository, UserRepository } from 'src/DB/Repositories';
import { BUSINESS_TIMEZONE, getBusinessDateString } from 'src/Common/Utils';
import { sendEmail } from 'src/Common/Utils/send-email.utils';
import { resolveSubscriptionState } from './subscription-state';

/** Days-before-expiry on which a reminder goes out. */
const TRIAL_REMINDER_DAYS = [7, 3, 1, 0];
const RENEWAL_REMINDER_DAYS = [7, 3, 0];

/** Whole days between two `YYYY-MM-DD` Cairo dates. */
export function daysBetweenBusinessDates(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

@Injectable()
export class SubscriptionRemindersService {
  private readonly logger = new Logger(SubscriptionRemindersService.name);

  constructor(
    private readonly restaurantRepository: RestaurantRepository,
    private readonly userRepository: UserRepository,
  ) {}

  /**
   * 09:00 Cairo — a business-hours nudge, not a 3am one.
   *
   * Day counting is done on Cairo calendar dates, not on elapsed
   * milliseconds, so "3 days left" means three sleeps rather than 72 hours.
   */
  @Cron('0 9 * * *', { timeZone: BUSINESS_TIMEZONE })
  async sendReminders(): Promise<void> {
    const now = new Date();
    const today = getBusinessDateString(now);

    const restaurants = await this.restaurantRepository.findMany({
      filters: {
        isDeleted: false,
        $or: [
          { 'subscription.trialEndsAt': { $ne: null } },
          { 'subscription.currentPeriodEnd': { $ne: null } },
        ],
      },
    });

    for (const restaurant of restaurants || []) {
      try {
        const sub = restaurant.subscription;
        const state = resolveSubscriptionState(sub, now);

        const target =
          state === 'trial'
            ? sub?.trialEndsAt
            : state === 'active' || state === 'grace'
              ? sub?.currentPeriodEnd
              : null;
        if (!target) continue;

        const daysLeft = daysBetweenBusinessDates(
          today,
          getBusinessDateString(new Date(target)),
        );
        const schedule =
          state === 'trial' ? TRIAL_REMINDER_DAYS : RENEWAL_REMINDER_DAYS;
        if (!schedule.includes(daysLeft)) continue;

        if (!restaurant.ownerUserId) continue;
        const owner = await this.userRepository.findOne({
          filters: { _id: restaurant.ownerUserId },
        });
        if (!owner?.email) continue;

        const plural = daysLeft === 1 ? '' : 's';
        const subject =
          state === 'trial'
            ? daysLeft === 0
              ? 'Your RestoMind trial ends today'
              : `Your RestoMind trial ends in ${daysLeft} day${plural}`
            : daysLeft === 0
              ? 'Your RestoMind subscription is due today'
              : `Your RestoMind subscription is due in ${daysLeft} day${plural}`;

        await sendEmail({
          to: owner.email,
          subject,
          html: `
            <h3>${subject}</h3>
            <p>Hi ${owner.firstName},</p>
            <p>Your products, offers, history and analytics are all safe — nothing
               is deleted. Choose a plan to keep your dashboard and your live
               offers running.</p>
            <p style="margin: 24px 0;">
              <a href="${process.env.FRONTEND_URL}/dashboard/billing" target="_blank" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Choose a Plan</a>
            </p>
          `,
        });

        this.logger.log(
          `Reminder (${state}, D-${daysLeft}) sent to ${owner.email}`,
        );
      } catch (error: any) {
        // One restaurant's bad data must not stop everyone else's reminders.
        this.logger.error(
          `Reminder failed for restaurant ${String(restaurant._id)}: ${error?.message}`,
        );
      }
    }
  }
}
