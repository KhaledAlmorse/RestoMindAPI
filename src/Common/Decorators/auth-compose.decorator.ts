import { applyDecorators } from '@nestjs/common';
import { Roles } from './roles.decorator';
import { UseGuards } from '@nestjs/common';
import { AuthGuard, RolesGuard } from '../Guards';

export function Auth(...roles: string[]) {
  return applyDecorators(Roles(roles), UseGuards(AuthGuard, RolesGuard));
}
