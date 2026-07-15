import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from '../Decorators';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    //* using the Reflactor Decorator
    //   const allowedRoles = this.reflector.get(Roles, context.getHandler());
    //* using metadata
    const allowedRoles = this.reflector.get('roles', context.getHandler());
    // if (!allowedRoles) return true;
    const request = context.switchToHttp().getRequest();
    const userRole = request['user'].user.role;

    if (allowedRoles.includes(userRole)) return true;
    else
      throw new UnauthorizedException(
        'You are not authorized to access this resource',
      );
  }
}
