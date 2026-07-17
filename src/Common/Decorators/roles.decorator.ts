import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { ROLES_KEY } from '../Constants/constants';

//* using SetMetadata Function to create decorator
export const Roles = (roles: string[]) => {
  return SetMetadata(ROLES_KEY, roles);
};

export const AuthUser = createParamDecorator(
  (data, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest();
    return request['user'];
  },
);
