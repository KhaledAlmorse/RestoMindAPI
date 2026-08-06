import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { type IAuthUser } from 'src/Common/Types';
import { getBusinessDateString, isValidDateString } from 'src/Common/Utils';
import {
  CompletePayoutDto,
  CreateAdjustmentDto,
  RecordPayoutDto,
} from './dto/payout.dto';
import { PayoutsService } from './payouts.service';

/**
 * Plain @Auth throughout, never @AuthPaid — a merchant whose subscription has
 * lapsed is still owed their money.
 */
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  private requireRestaurantId(user: IAuthUser): string {
    const restaurantId = user.user.restaurantId;
    if (!restaurantId) {
      throw new BadRequestException('No restaurant is assigned to your account');
    }
    return restaurantId.toString();
  }

  private resolveCutoff(cutoffDate?: string): string {
    const cutoff = cutoffDate ?? getBusinessDateString();
    if (!isValidDateString(cutoff)) {
      throw new BadRequestException('cutoffDate must be a valid YYYY-MM-DD');
    }
    return cutoff;
  }

  /** A merchant's own statement. Scoped to their restaurant, never a param. */
  @Get('statement')
  @Auth('manager', 'staff')
  getMine(
    @AuthUser() user: IAuthUser,
    @Query('cutoffDate') cutoffDate?: string,
  ) {
    return this.payoutsService.getStatement(
      this.requireRestaurantId(user),
      this.resolveCutoff(cutoffDate),
    );
  }

  @Get('statement/:restaurantId')
  @Auth('admin')
  getOne(
    @Param('restaurantId') restaurantId: string,
    @Query('cutoffDate') cutoffDate?: string,
  ) {
    return this.payoutsService.getStatement(
      restaurantId,
      this.resolveCutoff(cutoffDate),
    );
  }

  @Post(':restaurantId')
  @Auth('admin')
  record(
    @Param('restaurantId') restaurantId: string,
    @Body() body: RecordPayoutDto,
    @AuthUser() user: IAuthUser,
  ) {
    return this.payoutsService.recordPayout(
      restaurantId,
      body,
      user.user._id.toString(),
    );
  }

  @Patch(':payoutId/complete')
  @Auth('admin')
  complete(
    @Param('payoutId') payoutId: string,
    @Body() body: CompletePayoutDto,
    @AuthUser() user: IAuthUser,
  ) {
    return this.payoutsService.completePayout(
      payoutId,
      body,
      user.user._id.toString(),
    );
  }

  @Post(':restaurantId/adjustments')
  @Auth('admin')
  adjust(
    @Param('restaurantId') restaurantId: string,
    @Body() body: CreateAdjustmentDto,
    @AuthUser() user: IAuthUser,
  ) {
    return this.payoutsService.recordAdjustment(
      restaurantId,
      body,
      user.user._id.toString(),
    );
  }
}
