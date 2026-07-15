import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

//* using Reflector class to create decorator
// export const Roles = Reflector.createDecorator<string[]>();

//* using SetMetadata Function to create decorator
export const Roles = (roles: string[]) => {
  return SetMetadata('roles', roles);
};

export const AuthUser = createParamDecorator(
  (data, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest();
    return request['user'];
  },
);
