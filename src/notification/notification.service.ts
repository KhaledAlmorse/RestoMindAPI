import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types, isValidObjectId } from 'mongoose';
import {
  NotificationRepository,
  RestaurantRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { NotificationType } from './enums/notification-type.enum';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { NotificationGateway } from './notification.gateway';
import { NotificationPayload } from './interfaces/notification-payload.interface';
import { RolesEnum } from 'src/Common/Types';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly userRepository: UserRepository,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  private formatNotification(doc: any) {
    const obj = doc.toObject ? doc.toObject() : doc;
    return {
      id: obj._id.toString(),
      type: obj.type,
      title: obj.title,
      message: obj.message,
      relatedEntityId: obj.relatedEntityId
        ? obj.relatedEntityId.toString()
        : undefined,
      relatedEntityType: obj.relatedEntityType || undefined,
      isRead: obj.isRead ?? false,
      readAt: obj.readAt ? new Date(obj.readAt).toISOString() : undefined,
      createdAt: obj.createdAt
        ? new Date(obj.createdAt).toISOString()
        : new Date().toISOString(),
    };
  }

  /**
   * Core notification creation targeting a specific user ID.
   */
  async createForUser(
    userId: string,
    role: string,
    type: NotificationType,
    title: string,
    message: string,
    relatedEntityId?: string,
    relatedEntityType?: string,
    restaurantId?: string,
  ) {
    this.validateObjectId(userId);

    const notificationDoc = await this.notificationRepository.create({
      userId: new Types.ObjectId(userId),
      role,
      restaurantId: restaurantId ? new Types.ObjectId(restaurantId) : null,
      type,
      title,
      message,
      relatedEntityId: relatedEntityId ? new Types.ObjectId(relatedEntityId) : null,
      relatedEntityType: relatedEntityType || null,
      isRead: false,
    } as any);

    const formatted = this.formatNotification(notificationDoc);

    const payload: NotificationPayload = {
      id: formatted.id,
      type: formatted.type,
      title: formatted.title,
      message: formatted.message,
      relatedEntityId: formatted.relatedEntityId,
      relatedEntityType: formatted.relatedEntityType,
      isRead: formatted.isRead,
      createdAt: formatted.createdAt,
    };

    // Emit live WebSocket event
    try {
      this.notificationGateway.emitToUser(userId, payload);
    } catch (err: any) {
      this.logger.error(
        `Failed to emit socket notification to user ${userId}: ${err?.message}`,
      );
    }

    return notificationDoc;
  }

  /**
   * Creation method targeted at a restaurant's manager (owner) and staff.
   */
  async createForManager(
    restaurantId: string,
    type: NotificationType,
    title: string,
    message: string,
    relatedEntityId?: string,
    relatedEntityType?: string,
  ) {
    this.validateObjectId(restaurantId);
    const restObjId = new Types.ObjectId(restaurantId);

    const restaurant = await this.restaurantRepository.findOne({
      filters: { _id: restObjId },
    });

    const targetUserIds = new Set<string>();

    if (restaurant && restaurant.ownerUserId) {
      const ownerUserId = restaurant.ownerUserId._id
        ? restaurant.ownerUserId._id.toString()
        : restaurant.ownerUserId.toString();
      targetUserIds.add(ownerUserId);
    }

    // Find all active managers and staff members belonging to this restaurant
    const restaurantUsers = await this.userRepository.findMany({
      filters: {
        $or: [{ restaurantId: restObjId }, { restaurantId }],
        role: { $in: [RolesEnum.MANAGER, RolesEnum.STAFF] },
        isActive: true,
        isDeleted: false,
      },
    });

    if (restaurantUsers && restaurantUsers.length > 0) {
      for (const u of restaurantUsers) {
        targetUserIds.add(u._id.toString());
      }
    }

    if (targetUserIds.size === 0) {
      this.logger.warn(
        `Cannot create restaurant notification: No owner, manager, or staff found for ${restaurantId}`,
      );
      return [];
    }

    const createdNotifications: any[] = [];
    for (const userId of targetUserIds) {
      const userDoc = await this.userRepository.findOne({
        filters: { _id: new Types.ObjectId(userId) },
      });
      const userRole = userDoc?.role || 'staff';

      const notification = await this.createForUser(
        userId,
        userRole,
        type,
        title,
        message,
        relatedEntityId,
        relatedEntityType,
        restaurantId,
      );
      if (notification) {
        createdNotifications.push(notification);
      }
    }

    return createdNotifications;
  }

  /**
   * Creation method fanning out one notification per active admin user.
   */
  async fanOutToAdmins(
    type: NotificationType,
    title: string,
    message: string,
    relatedEntityId?: string,
    relatedEntityType?: string,
  ) {
    const admins = await this.userRepository.findMany({
      filters: { role: RolesEnum.ADMIN, isActive: true, isDeleted: false },
    });

    if (!admins || admins.length === 0) {
      this.logger.warn(`No active admin users found for fan-out notification.`);
      return [];
    }

    const createdNotifications: any[] = [];
    for (const admin of admins) {
      const notification = await this.createForUser(
        admin._id.toString(),
        'admin',
        type,
        title,
        message,
        relatedEntityId,
        relatedEntityType,
      );
      if (notification) {
        createdNotifications.push(notification);
      }
    }

    return createdNotifications;
  }

  /**
   * Paginated, filterable, and sortable notification listing for caller.
   */
  async getUserNotifications(userId: string, query: QueryNotificationsDto) {
    this.validateObjectId(userId);
    const {
      page = 1,
      limit = 20,
      isRead,
      type,
      createdAfter,
      createdBefore,
      sortBy = 'createdAt',
      order = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const filters: any = {
      userId: new Types.ObjectId(userId),
    };

    if (typeof isRead === 'boolean') {
      filters.isRead = isRead;
    }

    if (type) {
      filters.type = type;
    }

    if (createdAfter || createdBefore) {
      filters.createdAt = {};
      if (createdAfter) {
        filters.createdAt.$gte = new Date(createdAfter);
      }
      if (createdBefore) {
        filters.createdAt.$lte = new Date(createdBefore);
      }
    }

    const sortField = sortBy === 'readAt' ? 'readAt' : 'createdAt';
    const sortOrder = order === 'asc' ? 1 : -1;
    const sortStage: any = { [sortField]: sortOrder, _id: sortOrder };

    const totalItems =
      await this.notificationRepository.countDocuments(filters);
    const totalPages =
      Math.ceil(totalItems / limit) || (totalItems > 0 ? 1 : 0);

    const notifications = await this.notificationRepository.aggregate([
      { $match: filters },
      { $sort: sortStage },
      { $skip: skip },
      { $limit: limit },
    ]);

    const formattedData = notifications.map((doc) =>
      this.formatNotification(doc),
    );

    return {
      data: formattedData,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      },
    };
  }

  /**
   * Unread notification listing for caller.
   */
  async getUnreadNotifications(userId: string, query: QueryNotificationsDto) {
    return this.getUserNotifications(userId, { ...query, isRead: false });
  }

  /**
   * Unread badge count for caller.
   */
  async getUnreadCount(userId: string) {
    this.validateObjectId(userId);
    const count = await this.notificationRepository.countDocuments({
      userId: new Types.ObjectId(userId),
      isRead: false,
    });

    return { data: { count } };
  }

  /**
   * Mark single notification read (ownership check included).
   */
  async markAsRead(id: string, userId: string) {
    this.validateObjectId(id);
    this.validateObjectId(userId);

    const notification = await this.notificationRepository.findOne({
      filters: {
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.isRead) {
      return { data: this.formatNotification(notification) };
    }

    const updated = await this.notificationRepository.update({
      filters: { _id: notification._id },
      body: {
        isRead: true,
        readAt: new Date(),
      } as any,
    });

    return { data: this.formatNotification(updated ?? notification) };
  }

  /**
   * Mark all unread notifications read for caller.
   */
  async markAllAsRead(userId: string) {
    this.validateObjectId(userId);

    await this.notificationRepository.updateMany(
      {
        userId: new Types.ObjectId(userId),
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
    );

    return { message: 'All notifications marked as read' };
  }

  /**
   * Delete single notification (ownership check included).
   */
  async deleteNotification(id: string, userId: string) {
    this.validateObjectId(id);
    this.validateObjectId(userId);

    const deleted = await this.notificationRepository.delete({
      filters: {
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      },
    });

    if (!deleted) {
      throw new NotFoundException('Notification not found');
    }

    return { message: 'Notification deleted successfully' };
  }
}
