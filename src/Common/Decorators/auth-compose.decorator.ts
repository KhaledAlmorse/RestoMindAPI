import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuard, RolesGuard, SubscriptionGuard } from '../Guards';
import { ROLES_KEY, TOKEN_TYPE_KEY } from '../Constants/constants';
import { AuthOptions } from '../Types';

export function Auth(...args: (string | AuthOptions)[]) {
  let roles: string[] = [];
  let tokenType: 'access' | 'refresh' = 'access';

  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
    const options = args[0];
    roles = options.roles || [];
    tokenType = options.tokenType || 'access';
  } else {
    roles = args.filter((arg): arg is string => typeof arg === 'string');
  }

  return applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    SetMetadata(TOKEN_TYPE_KEY, tokenType),
    UseGuards(AuthGuard, RolesGuard),
  );
}

/**
 * Auth plus an active-subscription requirement.
 *
 * Converting a route is a one-word edit: `@Auth(...)` -> `@AuthPaid(...)`.
 *
 * Do NOT apply this to order routes. A lapsed merchant can still have paid,
 * undelivered orders in flight, and locking fulfilment would strand customers
 * who already handed over money — punishing the wrong party for the
 * merchant's unpaid invoice. Offer suspension stops NEW orders from arriving;
 * existing ones must be allowed to run to completion.
 */
export function AuthPaid(...args: (string | AuthOptions)[]) {
  return applyDecorators(Auth(...args), UseGuards(SubscriptionGuard));
}
