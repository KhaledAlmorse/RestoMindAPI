import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../Constants/constants';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    //* using metadata
    const allowedRoles = this.reflector.get<string[]>(
      ROLES_KEY,
      context.getHandler(),
    );
    if (!allowedRoles || allowedRoles.length === 0) return true;
    const request = context.switchToHttp().getRequest();
    const userRole = request['user']?.user?.role;

    if (allowedRoles.includes(userRole)) return true;
    else
      throw new ForbiddenException(
        'You do not have permission to access this resource',
      );
  }
}
