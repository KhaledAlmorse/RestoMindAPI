import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuard, RolesGuard } from '../Guards';
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
