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

  /**
   * Refund a whole group, one restaurant's order, or specific line items.
   *
   * Admin only — refunds are a support action. A merchant refunding their own
   * order reverses their own commission and moves a customer's money with no
   * second pair of eyes; a customer self-refunding does the same after the
   * goods have left the kitchen. Both now route through support instead.
   */
  @Post('group/:groupId/refunds')
  @Auth('admin')
  requestRefund(
    @Param('groupId') groupId: string,
    @Body() body: CreateRefundDto,
    @AuthUser() user: IAuthUser,
  ) {
    return this.refundsService.requestRefund(groupId, body, user.user);
  }

  /**
   * Approve, reject or hand-settle a refund.
   *
   * Admin only, matching creation: reviewing is what actually moves the money,
   * and `decision: 'settle'` marks a gateway-failed refund as paid by hand.
   * Rows still sitting in REQUESTED from before support-only refunds are
   * resolved here too.
   */
  @Patch('refunds/:refundId/review')
  @Auth('admin')
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
