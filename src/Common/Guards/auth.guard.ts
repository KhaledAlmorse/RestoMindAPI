import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  NotFoundException,
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
        throw new UnauthorizedException('Token has been revoked');
      }

      const { id } = decoded as { id: string };
      const user = await this.userRepository.findOne({ filters: { _id: id } });
      if (!user) {
        throw new NotFoundException('User not found, please Login ');
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
