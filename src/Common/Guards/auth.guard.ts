import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TokenService } from '../Services';
import { RevokeTokenRepository, UserRepository } from 'src/DB/Repositories';
import { TOKEN_TYPE_KEY } from '../Constants/constants';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly userRepository: UserRepository,
    private readonly revokeTokenRepository: RevokeTokenRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const request = context.switchToHttp().getRequest();
      const token = request.headers['authorization']?.split(' ')[1];

      if (!token) {
        throw new UnauthorizedException('No token provided, please Login ');
      }

      const tokenType =
        this.reflector.getAllAndOverride<'access' | 'refresh'>(TOKEN_TYPE_KEY, [
          context.getHandler(),
          context.getClass(),
        ]) || 'access';

      const secret =
        tokenType === 'refresh'
          ? process.env.REFRESH_TOKEN_SECRET
          : process.env.ACCESS_TOKEN_SECRET;

      const decoded = this.tokenService.verify(token, {
        secret: secret as string,
      });

      const isTokenRevoked = await this.revokeTokenRepository.findOne({
        filters: { tokenId: decoded.jti },
      });

      if (isTokenRevoked) {
        const revokedAt = (isTokenRevoked as any).createdAt
          ? new Date((isTokenRevoked as any).createdAt).getTime()
          : 0;
        const isRecentRotation =
          tokenType === 'refresh' && Date.now() - revokedAt < 60000;

        if (!isRecentRotation) {
          throw new UnauthorizedException('Token has been revoked');
        }
      }

      const { id } = decoded as { id: string };
      const user = await this.userRepository.findOne({ filters: { _id: id } });
      if (!user) {
        // 401, not 404: the resource the caller asked for is not missing —
        // their token is. Answering 404 makes every client treat a dead
        // session as an application error, so the stale cookie is never
        // cleared and the user sees "User not found" on every page until
        // they happen to sign out by hand.
        throw new UnauthorizedException('User not found, please Login ');
      }

      if (user.isActive === false) {
        throw new UnauthorizedException('User account is deactivated');
      }

      if (user.passwordChangedAt) {
        const passwordChangedTime = Math.floor(
          new Date(user.passwordChangedAt).getTime() / 1000,
        );
        if (decoded.iat && decoded.iat < passwordChangedTime) {
          throw new UnauthorizedException(
            'Token has been revoked due to password change',
          );
        }
      }

      if ((user as any).tokensRevokedAt) {
        const tokensRevokedTime = Math.floor(
          new Date((user as any).tokensRevokedAt).getTime() / 1000,
        );
        if (decoded.iat && decoded.iat <= tokensRevokedTime) {
          throw new UnauthorizedException('Token has been revoked');
        }
      }

      request.user = { user, token: decoded };
      return true;
    } catch (error) {
      console.log(error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new UnauthorizedException('Invalid token, please Login ');
    }
  }
}
