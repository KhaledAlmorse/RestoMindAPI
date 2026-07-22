import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { RolesEnum } from '../Types';

@Injectable()
export class RestaurantOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user?.user;

    if (!user) {
      throw new ForbiddenException('User context is missing');
    }

    // Admins bypass restaurant ownership restrictions
    if (user.role === RolesEnum.ADMIN) {
      return true;
    }

    if (user.role === RolesEnum.MANAGER) {
      const restaurantIdParam =
        request.params?.restaurantId ||
        request.params?.id ||
        request.query?.restaurantId;

      if (!user.restaurantId) {
        throw new ForbiddenException(
          'No restaurant is assigned to your account',
        );
      }

      if (
        restaurantIdParam &&
        user.restaurantId.toString() !== restaurantIdParam.toString()
      ) {
        throw new ForbiddenException(
          'You can only access or modify data for your own restaurant',
        );
      }
      return true;
    }

    return true;
  }
}
