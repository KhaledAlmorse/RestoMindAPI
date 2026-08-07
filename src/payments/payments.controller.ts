import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { type IAuthUser } from 'src/Common/Types';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Paymob's Transaction Processed callback.
   *
   * Deliberately unauthenticated at the framework level — the HMAC *is* the
   * authentication (verified in PaymentsService), and Paymob cannot send a
   * bearer token.
   *
   * Always answers 200, even when the payload is rejected: a non-2xx makes
   * Paymob retry, and retrying a forged callback achieves nothing but load.
   * The outcome is in the body for our own log correlation, not for Paymob.
   *
   * DO NOT give `body` a class-based DTO. main.ts installs a global
   * ValidationPipe with `forbidNonWhitelisted: true`; an inline type
   * annotation resolves to `Object`, which the pipe skips, but a real DTO
   * would cause Paymob's ~50-field payload to be rejected outright.
   */
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Body() body: { obj?: Record<string, any> },
    @Query('hmac') hmac: string,
  ) {
    if (!body?.obj) return { received: true, outcome: 'rejected' };
    const outcome = await this.paymentsService.processCallback(body.obj, hmac);
    return { received: true, outcome };
  }

  /**
   * Drives the frontend payment-method picker, so enabling Vodafone Cash is
   * an environment change rather than a frontend deploy.
   */
  @Get('methods')
  @Auth('customer', 'manager', 'admin', 'staff')
  getMethods() {
    return { data: this.paymentsService.getEnabledPaymentMethods() };
  }

  /**
   * Settles the caller's own payment immediately on return from Paymob,
   * rather than waiting for a callback that may be slow — or, on localhost,
   * that will never arrive at all.
   *
   * Plain @Auth, never @AuthPaid: this is the very call that turns an unpaid
   * merchant into a paid one.
   */
  @Post('reconcile/:paymobOrderId')
  @HttpCode(200)
  @Auth('customer', 'manager', 'admin', 'staff')
  reconcile(
    @Param('paymobOrderId', ParseIntPipe) paymobOrderId: number,
    @AuthUser() user: IAuthUser,
  ) {
    return this.paymentsService.reconcileByPaymobOrderId(
      paymobOrderId,
      user.user._id,
    );
  }
}
