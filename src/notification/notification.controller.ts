import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { type Response } from 'express';
import { NotificationService } from './notification.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { type IAuthUser } from 'src/Common/Types';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  // 1. GET /notifications/unread-count - Unread badge count
  @Get('unread-count')
  @Auth('manager', 'admin')
  async getUnreadCount(
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.notificationService.getUnreadCount(
      user.user._id.toString(),
    );
    res.status(HttpStatus.OK).json({ success: true, ...result });
  }

  // 2. GET /notifications/unread - Shorthand unread notifications listing
  @Get('unread')
  @Auth('manager', 'admin')
  async getUnreadNotifications(
    @Query() query: QueryNotificationsDto,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.notificationService.getUnreadNotifications(
      user.user._id.toString(),
      query,
    );
    res.status(HttpStatus.OK).json({ success: true, ...result });
  }

  // 3. GET /notifications - Paginated notification list
  @Get()
  @Auth('manager', 'admin')
  async getUserNotifications(
    @Query() query: QueryNotificationsDto,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.notificationService.getUserNotifications(
      user.user._id.toString(),
      query,
    );
    res.status(HttpStatus.OK).json({ success: true, ...result });
  }

  // 4. PATCH /notifications/read-all - Mark all caller's notifications read
  @Patch('read-all')
  @Auth('manager', 'admin')
  async markAllAsRead(
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.notificationService.markAllAsRead(
      user.user._id.toString(),
    );
    res.status(HttpStatus.OK).json({ success: true, ...result });
  }

  // 5. PATCH /notifications/:id/read - Mark single notification read
  @Patch(':id/read')
  @Auth('manager', 'admin')
  async markAsRead(
    @Param('id') id: string,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.notificationService.markAsRead(
      id,
      user.user._id.toString(),
    );
    res.status(HttpStatus.OK).json({ success: true, ...result });
  }

  // 6. DELETE /notifications/:id - Delete single notification
  @Delete(':id')
  @Auth('manager', 'admin')
  async deleteNotification(
    @Param('id') id: string,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.notificationService.deleteNotification(
      id,
      user.user._id.toString(),
    );
    res.status(HttpStatus.OK).json({ success: true, ...result });
  }
}
