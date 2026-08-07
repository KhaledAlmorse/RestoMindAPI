import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { TokenService } from 'src/Common/Services';
import { RevokeTokenRepository, UserRepository } from 'src/DB/Repositories';
import { NotificationPayload } from './interfaces/notification-payload.interface';

@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: '*' },
})
@Injectable()
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  constructor(
    private readonly tokenService: TokenService,
    private readonly userRepository: UserRepository,
    private readonly revokeTokenRepository: RevokeTokenRepository,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const rawToken =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization;

      if (!rawToken) {
        this.logger.warn(
          `Socket connection rejected: No token provided (${client.id})`,
        );
        client.disconnect();
        return;
      }

      const token = rawToken.startsWith('Bearer ')
        ? rawToken.slice(7).trim()
        : rawToken.trim();

      const decoded = this.tokenService.verify(token, {
        secret: process.env.ACCESS_TOKEN_SECRET as string,
      }) as { id: string; jti?: string; iat?: number };

      if (decoded.jti) {
        const isTokenRevoked = await this.revokeTokenRepository.findOne({
          filters: { tokenId: decoded.jti },
        });

        if (isTokenRevoked) {
          this.logger.warn(
            `Socket connection rejected: Token revoked (${client.id})`,
          );
          client.disconnect();
          return;
        }
      }

      const user = await this.userRepository.findOne({
        filters: { _id: decoded.id },
      });

      if (!user || user.isActive === false || user.isDeleted === true) {
        this.logger.warn(
          `Socket connection rejected: User inactive or not found (${client.id})`,
        );
        client.disconnect();
        return;
      }

      if (user.passwordChangedAt && decoded.iat) {
        const passwordChangedTime = Math.floor(
          new Date(user.passwordChangedAt).getTime() / 1000,
        );
        if (decoded.iat < passwordChangedTime) {
          this.logger.warn(
            `Socket connection rejected: Password changed (${client.id})`,
          );
          client.disconnect();
          return;
        }
      }

      const userIdStr = user._id.toString();
      client.data.userId = userIdStr;
      client.data.user = user;

      await client.join(`user:${userIdStr}`);
      this.logger.log(
        `Socket client connected: ${client.id} joined room user:${userIdStr}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Socket connection error (${client.id}): ${err?.message}`,
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Socket client disconnected: ${client.id}`);
  }

  emitToUser(userId: string, payload: NotificationPayload) {
    if (this.server) {
      this.server.to(`user:${userId}`).emit('notification:new', payload);
    }
  }
}
