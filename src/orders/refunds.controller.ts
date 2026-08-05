import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { type IAuthUser } from 'src/Common/Types';
import { CreateRefundDto, ReviewRefundDto } from './dto/refund.dto';
import { RefundsService } from './refunds.service';

/**
 * Plain @Auth throughout, never @AuthPaid.
 *
 * A customer's right to their money back is not conditional on whether the
 * merchant has paid their own subscription invoice.
 */
@Controller('orders')
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  /** Refund a whole group, one restaurant's order, or specific line items. */
  @Post('group/:groupId/refunds')
  @Auth('customer', 'manager', 'admin', 'staff')
  requestRefund(
    @Param('groupId') groupId: string,
    @Body() body: CreateRefundDto,
    @AuthUser() user: IAuthUser,
  ) {
    return this.refundsService.requestRefund(groupId, body, user.user);
  }

  /** Approve or reject a customer request that needed a human. */
  @Patch('refunds/:refundId/review')
  @Auth('manager', 'admin')
  reviewRefund(
    @Param('refundId') refundId: string,
    @Body() body: ReviewRefundDto,
    @AuthUser() user: IAuthUser,
  ) {
    return this.refundsService.reviewRefund(refundId, body, user.user);
  }

  @Get('refunds')
  @Auth('manager', 'admin', 'staff')
  listRefunds(@AuthUser() user: IAuthUser) {
    return this.refundsService.listRefunds(user.user);
  }
}
