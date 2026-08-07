import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { RestaurantRepository } from 'src/DB/Repositories';
import {
  hasDashboardAccess,
  resolveSubscriptionState,
} from 'src/subscriptions/subscription-state';
import { RolesEnum } from '../Types';

/**
 * Blocks dashboard routes when the restaurant's subscription is not active.
 *
 * Answers 402 Payment Required with a structured body so the frontend can
 * route straight to billing, rather than having to guess from a bare 403.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly restaurantRepository: RestaurantRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user?.user;

    if (!user) {
      throw new ForbiddenException('User context is missing');
    }

    // Admins are platform staff, not tenants — they have no subscription.
    // Matches the bypass already in RestaurantOwnerGuard.
    if (user.role === RolesEnum.ADMIN) return true;

    if (!user.restaurantId) {
      throw new ForbiddenException('No restaurant is assigned to your account');
    }

    const restaurant = await this.restaurantRepository.findOne({
      filters: { _id: new Types.ObjectId(user.restaurantId.toString()) },
      select: 'subscription',
    });

    const sub = restaurant?.subscription;
    const state = resolveSubscriptionState(sub);

    if (hasDashboardAccess(state)) return true;

    throw new HttpException(
      {
        code: 'SUBSCRIPTION_REQUIRED',
        message:
          'Your subscription is not active. Choose a plan to unlock the dashboard.',
        state,
        tier: sub?.tier ?? null,
        trialEndsAt: sub?.trialEndsAt ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
