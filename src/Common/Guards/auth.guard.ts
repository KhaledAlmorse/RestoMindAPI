import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from '../Services';
import { RevokeTokenRepository, UserRepository } from 'src/DB/Repositories';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
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

      const decoded = this.tokenService.verify(token, {
        secret: process.env.ACCESS_TOKEN_SECRET as string,
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
