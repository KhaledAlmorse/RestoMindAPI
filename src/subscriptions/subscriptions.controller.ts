import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { type IAuthUser } from 'src/Common/Types';
import { SetTrialDto, StartCheckoutDto } from './dto/subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Plain @Auth throughout, never @AuthPaid — an unpaid merchant must be able
 * to reach the very endpoints that let them pay.
 */
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  private requireRestaurantId(user: IAuthUser): string {
    const restaurantId = user.user.restaurantId;
    if (!restaurantId) {
      throw new BadRequestException(
        'No restaurant is assigned to your account',
      );
    }
    return restaurantId.toString();
  }

  @Get('me')
  @Auth('manager', 'staff', 'admin')
  getMine(@AuthUser() user: IAuthUser) {
    return this.subscriptionsService.getMine(this.requireRestaurantId(user));
  }

  @Post('checkout')
  @Auth('manager')
  startCheckout(@AuthUser() user: IAuthUser, @Body() body: StartCheckoutDto) {
    return this.subscriptionsService.startCheckout(
      user.user._id.toString(),
      this.requireRestaurantId(user),
      body.tier,
      body.method,
    );
  }

  @Patch(':restaurantId/trial')
  @Auth('admin')
  setTrial(
    @Param('restaurantId') restaurantId: string,
    @Body() body: SetTrialDto,
    @AuthUser() user: IAuthUser,
  ) {
    return this.subscriptionsService.setTrial(
      restaurantId,
      body.trialEndsAt ?? null,
      user.user._id.toString(),
    );
  }
}
