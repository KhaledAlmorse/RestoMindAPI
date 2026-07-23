import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OfferStatusEnum } from 'src/Common/Types';
import {
  Offer,
  OfferType,
  Order,
  OrderGroup,
  OrderGroupType,
  OrderType,
  Restaurant,
  RestaurantType,
} from 'src/DB/Models';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import {
  DashboardAlert,
  DashboardStatsResponse,
  ManagerDashboardStatsResponse,
  OrdersByStatus,
} from './interfaces/dashboard.interface';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(OrderGroup.name)
    private readonly orderGroupModel: Model<OrderGroupType>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderType>,
    @InjectModel(Offer.name)
    private readonly offerModel: Model<OfferType>,
    @InjectModel(Restaurant.name)
    private readonly restaurantModel: Model<RestaurantType>,
  ) {}

  private parseAndValidateDates(query: DashboardQueryDto) {
    const now = new Date();
    let startDateObj: Date;
    let endDateObj: Date;

    if (!query.startDate && !query.endDate) {
      endDateObj = new Date(now);
      startDateObj = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else {
      if (query.endDate) {
        endDateObj = this.parseDate(query.endDate, 'end');
      } else {
        endDateObj = new Date(now);
      }

      if (query.startDate) {
        startDateObj = this.parseDate(query.startDate, 'start');
      } else {
        startDateObj = new Date(endDateObj.getTime() - 7 * 24 * 60 * 60 * 1000);
      }
    }

    if (isNaN(startDateObj.getTime())) {
      throw new BadRequestException('Invalid startDate format');
    }
    if (isNaN(endDateObj.getTime())) {
      throw new BadRequestException('Invalid endDate format');
    }

    if (startDateObj > endDateObj) {
      throw new BadRequestException(
        'startDate must be less than or equal to endDate',
      );
    }

    const durationMs = endDateObj.getTime() - startDateObj.getTime();
    const prevStartDateObj = new Date(startDateObj.getTime() - durationMs);
    const prevEndDateObj = new Date(startDateObj.getTime());

    return {
      startDate: startDateObj,
      endDate: endDateObj,
      prevStartDate: prevStartDateObj,
      prevEndDate: prevEndDateObj,
    };
  }

  private parseDate(dateStr: string, mode: 'start' | 'end'): Date {
    const trimmed = dateStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return new Date(
        mode === 'start'
          ? `${trimmed}T00:00:00.000Z`
          : `${trimmed}T23:59:59.999Z`,
      );
    }
    return new Date(trimmed);
  }

  private calculateChangePercent(current: number, previous: number): number {
    if (previous === 0) {
      return current > 0 ? 100 : 0;
    }
    const pct = ((current - previous) / previous) * 100;
    return Number(pct.toFixed(2));
  }

  private buildRevenueTrend(
    startDate: Date,
    endDate: Date,
    aggregatedTrend: Array<{
      _id?: string;
      date?: string;
      revenue: number;
      orders: number;
    }>,
  ): Array<{ date: string; revenue: number; orders: number }> {
    const trendMap = new Map<string, { revenue: number; orders: number }>();

    for (const item of aggregatedTrend) {
      const key = item._id || item.date;
      if (key) {
        trendMap.set(key, {
          revenue: Number(item.revenue || 0),
          orders: Number(item.orders || 0),
        });
      }
    }

    const result: Array<{ date: string; revenue: number; orders: number }> = [];
    const current = new Date(startDate);
    current.setUTCHours(0, 0, 0, 0);

    const endLimit = new Date(endDate);

    while (current <= endLimit) {
      const dateStr = current.toISOString().split('T')[0];
      const existing = trendMap.get(dateStr);
      result.push({
        date: dateStr,
        revenue: existing ? existing.revenue : 0,
        orders: existing ? existing.orders : 0,
      });
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return result.sort((a, b) => a.date.localeCompare(b.date));
  }

  private buildOrdersByStatus(
    rawCounts: Array<{ _id: string; count: number }>,
  ): OrdersByStatus {
    const initial: OrdersByStatus = {
      Pending: 0,
      Confirmed: 0,
      Preparing: 0,
      Ready: 0,
      OutForDelivery: 0,
      Delivered: 0,
      Cancelled: 0,
    };

    for (const item of rawCounts) {
      if (!item._id) continue;
      const key =
        item._id === 'Out For Delivery' ? 'OutForDelivery' : item._id;
      if (Object.prototype.hasOwnProperty.call(initial, key)) {
        (initial as any)[key] = item.count || 0;
      }
    }

    return initial;
  }

  private computeGroupOverallStatus(childOrders: any[]): string {
    if (!childOrders || childOrders.length === 0) return 'Pending';
    const statuses = childOrders.map((o) => o.status);

    const allCancelled = statuses.every((s) => s === 'Cancelled');
    if (allCancelled) return 'Cancelled';

    const firstStatus = statuses[0];
    const allSame = statuses.every((s) => s === firstStatus);
    if (allSame) return firstStatus;

    const hasDelivered = statuses.some((s) => s === 'Delivered');
    if (hasDelivered) return 'Partially Delivered';

    const hasCancelled = statuses.some((s) => s === 'Cancelled');
    if (hasCancelled) return 'Partially Cancelled';

    return 'Processing';
  }

  async getAdminDashboard(
    query: DashboardQueryDto,
  ): Promise<DashboardStatsResponse> {
    const { startDate, endDate, prevStartDate, prevEndDate } =
      this.parseAndValidateDates(query);

    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

    // Pipeline for Admin OrderGroup Aggregations using $facet
    const aggregationResult = await this.orderGroupModel.aggregate([
      {
        $lookup: {
          from: 'orders',
          localField: '_id',
          foreignField: 'groupOrderId',
          as: 'childOrders',
        },
      },
      {
        $addFields: {
          overallStatus: {
            $cond: [
              { $eq: [{ $size: '$childOrders' }, 0] },
              'Pending',
              {
                $cond: [
                  {
                    $allElementsTrue: {
                      $map: {
                        input: '$childOrders',
                        as: 'o',
                        in: { $eq: ['$$o.status', 'Cancelled'] },
                      },
                    },
                  },
                  'Cancelled',
                  {
                    $cond: [
                      {
                        $eq: [
                          { $size: { $setUnion: '$childOrders.status' } },
                          1,
                        ],
                      },
                      { $arrayElemAt: ['$childOrders.status', 0] },
                      {
                        $cond: [
                          { $in: ['Delivered', '$childOrders.status'] },
                          'Partially Delivered',
                          {
                            $cond: [
                              { $in: ['Cancelled', '$childOrders.status'] },
                              'Partially Cancelled',
                              'Processing',
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
      {
        $facet: {
          currentOrdersCount: [
            {
              $match: {
                createdAt: { $gte: startDate, $lte: endDate },
              },
            },
            { $count: 'count' },
          ],
          currentRevenue: [
            {
              $match: {
                createdAt: { $gte: startDate, $lte: endDate },
                overallStatus: 'Delivered',
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: '$finalTotalPrice' },
              },
            },
          ],
          prevOrdersCount: [
            {
              $match: {
                createdAt: { $gte: prevStartDate, $lt: prevEndDate },
              },
            },
            { $count: 'count' },
          ],
          prevRevenue: [
            {
              $match: {
                createdAt: { $gte: prevStartDate, $lt: prevEndDate },
                overallStatus: 'Delivered',
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: '$finalTotalPrice' },
              },
            },
          ],
          pendingOrdersCount: [
            {
              $match: { overallStatus: 'Pending' },
            },
            { $count: 'count' },
          ],
          ordersByStatus: [
            {
              $match: {
                createdAt: { $gte: startDate, $lte: endDate },
              },
            },
            {
              $group: {
                _id: '$overallStatus',
                count: { $sum: 1 },
              },
            },
          ],
          revenueTrend: [
            {
              $match: {
                createdAt: { $gte: startDate, $lte: endDate },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
                },
                orders: { $sum: 1 },
                revenue: {
                  $sum: {
                    $cond: [
                      { $eq: ['$overallStatus', 'Delivered'] },
                      '$finalTotalPrice',
                      0,
                    ],
                  },
                },
              },
            },
            { $sort: { _id: 1 } },
          ],
          stuckPendingCount: [
            {
              $match: {
                overallStatus: 'Pending',
                createdAt: { $lt: thirtyMinsAgo },
              },
            },
            { $count: 'count' },
          ],
          currentCancelledCount: [
            {
              $match: {
                createdAt: { $gte: startDate, $lte: endDate },
                overallStatus: 'Cancelled',
              },
            },
            { $count: 'count' },
          ],
        },
      },
    ]);

    const facet = aggregationResult[0] || {};

    const currentOrders = facet.currentOrdersCount?.[0]?.count || 0;
    const currentRevenue = facet.currentRevenue?.[0]?.total || 0;
    const prevOrders = facet.prevOrdersCount?.[0]?.count || 0;
    const prevRevenue = facet.prevRevenue?.[0]?.total || 0;
    const pendingOrders = facet.pendingOrdersCount?.[0]?.count || 0;
    const stuckPendingCount = facet.stuckPendingCount?.[0]?.count || 0;
    const cancelledCount = facet.currentCancelledCount?.[0]?.count || 0;

    // Active Restaurants
    const activeRestaurants = await this.restaurantModel.countDocuments({
      isActive: true,
      isDeleted: false,
    });

    // Active non-deleted restaurant ObjectIds for offer calculation
    const activeRestaurantDocs = await this.restaurantModel
      .find({ isActive: true, isDeleted: false })
      .select('_id')
      .exec();
    const activeRestaurantIds = activeRestaurantDocs.map((r) => r._id);

    // Active Offers count
    const activeOffers = await this.offerModel.countDocuments({
      status: OfferStatusEnum.ACTIVE,
      isDeleted: false,
      restaurantId: { $in: activeRestaurantIds },
    });

    // Recent 5 Order Groups
    const recentOrderGroups = await this.orderGroupModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .populate({
        path: 'orderIds',
        populate: { path: 'restaurantId' },
      })
      .exec();

    const recentOrders = recentOrderGroups.map((group: any) => {
      const childOrders = group.orderIds || [];
      const restaurantNamesSet = new Set<string>();

      for (const child of childOrders) {
        if (child?.restaurantId) {
          const name =
            child.restaurantId.name ||
            child.restaurantId.restaurantName ||
            child.restaurantId.title ||
            '';
          if (name) restaurantNamesSet.add(name);
        }
      }

      return {
        orderGroupId: group._id.toString(),
        customerName: group.fullName || '',
        restaurantNames: Array.from(restaurantNamesSet),
        finalTotalPrice: group.finalTotalPrice || 0,
        overallStatus: this.computeGroupOverallStatus(childOrders),
        createdAt: group.createdAt
          ? new Date(group.createdAt).toISOString()
          : new Date().toISOString(),
      };
    });

    // Alerts generation
    const alerts: DashboardAlert[] = [];

    // 1. stuck_pending
    if (stuckPendingCount > 0) {
      alerts.push({
        id: 'alert_stuck_pending',
        type: 'stuck_pending',
        severity: 'warning',
        message: `${stuckPendingCount} pending order(s) older than 30 minutes.`,
        count: stuckPendingCount,
        actionUrl: '/orders?status=Pending',
      });
    }

    // 2. high_cancellation
    if (currentOrders > 0) {
      const cancellationRate = (cancelledCount / currentOrders) * 100;
      if (cancellationRate > 20) {
        alerts.push({
          id: 'alert_high_cancellation',
          type: 'high_cancellation',
          severity: 'critical',
          message: `High cancellation rate of ${cancellationRate.toFixed(1)}% in the selected period.`,
          count: cancelledCount,
          actionUrl: '/orders?status=Cancelled',
        });
      }
    }

    // 3. no_active_offers (Count active restaurants with 0 active offers)
    if (activeRestaurantIds.length > 0) {
      const offersByRestaurant = await this.offerModel.aggregate([
        {
          $match: {
            status: OfferStatusEnum.ACTIVE,
            isDeleted: false,
            restaurantId: { $in: activeRestaurantIds },
          },
        },
        {
          $group: {
            _id: '$restaurantId',
            count: { $sum: 1 },
          },
        },
      ]);

      const restaurantsWithOffers = new Set(
        offersByRestaurant.map((o) => o._id.toString()),
      );
      const restaurantsWithoutOffers = activeRestaurantIds.filter(
        (id) => !restaurantsWithOffers.has(id.toString()),
      );

      if (restaurantsWithoutOffers.length > 0) {
        alerts.push({
          id: 'alert_no_active_offers',
          type: 'no_active_offers',
          severity: 'info',
          message: `${restaurantsWithoutOffers.length} active restaurant(s) currently have no active offers.`,
          count: restaurantsWithoutOffers.length,
          actionUrl: '/offers',
        });
      }
    }

    // 4. inactive_restaurants
    const inactiveRestaurantsCount = await this.restaurantModel.countDocuments({
      isActive: false,
      isDeleted: false,
    });
    if (inactiveRestaurantsCount > 0) {
      alerts.push({
        id: 'alert_inactive_restaurants',
        type: 'inactive_restaurants',
        severity: 'warning',
        message: `${inactiveRestaurantsCount} restaurant(s) are currently inactive.`,
        count: inactiveRestaurantsCount,
        actionUrl: '/restaurants?status=inactive',
      });
    }

    return {
      kpis: {
        revenue: {
          current: currentRevenue,
          previous: prevRevenue,
          changePercent: this.calculateChangePercent(
            currentRevenue,
            prevRevenue,
          ),
        },
        orders: {
          current: currentOrders,
          previous: prevOrders,
          changePercent: this.calculateChangePercent(currentOrders, prevOrders),
        },
        activeOffers,
        pendingOrders,
        activeRestaurants,
      },
      revenueTrend: this.buildRevenueTrend(
        startDate,
        endDate,
        facet.revenueTrend || [],
      ),
      ordersByStatus: this.buildOrdersByStatus(facet.ordersByStatus || []),
      recentOrders,
      alerts,
    };
  }

  async getManagerDashboard(
    managerUser: any,
    query: DashboardQueryDto,
  ): Promise<ManagerDashboardStatsResponse> {
    const rawRestaurantId = managerUser?.user?.restaurantId;
    if (!rawRestaurantId) {
      throw new ForbiddenException(
        'Manager does not have an assigned restaurant',
      );
    }

    const restaurantObjId = new Types.ObjectId(rawRestaurantId.toString());

    const restaurant = await this.restaurantModel.findOne({
      _id: restaurantObjId,
      isDeleted: false,
    });

    if (!restaurant) {
      throw new NotFoundException('Assigned restaurant not found');
    }

    const { startDate, endDate, prevStartDate, prevEndDate } =
      this.parseAndValidateDates(query);

    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

    // Pipeline for Manager Order Aggregations using $facet
    const aggregationResult = await this.orderModel.aggregate([
      {
        $match: { restaurantId: restaurantObjId },
      },
      {
        $facet: {
          currentOrdersCount: [
            {
              $match: {
                createdAt: { $gte: startDate, $lte: endDate },
              },
            },
            { $count: 'count' },
          ],
          currentRevenue: [
            {
              $match: {
                createdAt: { $gte: startDate, $lte: endDate },
                status: 'Delivered',
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: '$finalTotalPrice' },
              },
            },
          ],
          prevOrdersCount: [
            {
              $match: {
                createdAt: { $gte: prevStartDate, $lt: prevEndDate },
              },
            },
            { $count: 'count' },
          ],
          prevRevenue: [
            {
              $match: {
                createdAt: { $gte: prevStartDate, $lt: prevEndDate },
                status: 'Delivered',
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: '$finalTotalPrice' },
              },
            },
          ],
          pendingOrdersCount: [
            {
              $match: { status: 'Pending' },
            },
            { $count: 'count' },
          ],
          ordersByStatus: [
            {
              $match: {
                createdAt: { $gte: startDate, $lte: endDate },
              },
            },
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
              },
            },
          ],
          revenueTrend: [
            {
              $match: {
                createdAt: { $gte: startDate, $lte: endDate },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
                },
                orders: { $sum: 1 },
                revenue: {
                  $sum: {
                    $cond: [
                      { $eq: ['$status', 'Delivered'] },
                      '$finalTotalPrice',
                      0,
                    ],
                  },
                },
              },
            },
            { $sort: { _id: 1 } },
          ],
          stuckPendingCount: [
            {
              $match: {
                status: 'Pending',
                createdAt: { $lt: thirtyMinsAgo },
              },
            },
            { $count: 'count' },
          ],
          currentCancelledCount: [
            {
              $match: {
                createdAt: { $gte: startDate, $lte: endDate },
                status: 'Cancelled',
              },
            },
            { $count: 'count' },
          ],
        },
      },
    ]);

    const facet = aggregationResult[0] || {};

    const currentOrders = facet.currentOrdersCount?.[0]?.count || 0;
    const currentRevenue = facet.currentRevenue?.[0]?.total || 0;
    const prevOrders = facet.prevOrdersCount?.[0]?.count || 0;
    const prevRevenue = facet.prevRevenue?.[0]?.total || 0;
    const pendingOrders = facet.pendingOrdersCount?.[0]?.count || 0;
    const stuckPendingCount = facet.stuckPendingCount?.[0]?.count || 0;
    const cancelledCount = facet.currentCancelledCount?.[0]?.count || 0;

    // Active offers for manager's restaurant
    const activeOffers = restaurant.isActive
      ? await this.offerModel.countDocuments({
          restaurantId: restaurantObjId,
          status: OfferStatusEnum.ACTIVE,
          isDeleted: false,
        })
      : 0;

    // Recent 5 orders for manager's restaurant
    const recentSubOrders = await this.orderModel
      .find({ restaurantId: restaurantObjId })
      .sort({ createdAt: -1 })
      .limit(5)
      .exec();

    const recentOrders = recentSubOrders.map((ord: any) => ({
      orderGroupId: ord.groupOrderId
        ? ord.groupOrderId.toString()
        : ord._id.toString(),
      customerName: ord.fullName || '',
      restaurantNames: [restaurant.name],
      finalTotalPrice: ord.finalTotalPrice || 0,
      overallStatus: ord.status || 'Pending',
      createdAt: ord.createdAt
        ? new Date(ord.createdAt).toISOString()
        : new Date().toISOString(),
    }));

    // Alerts generation for manager
    const alerts: DashboardAlert[] = [];

    // 1. stuck_pending
    if (stuckPendingCount > 0) {
      alerts.push({
        id: 'alert_stuck_pending',
        type: 'stuck_pending',
        severity: 'warning',
        message: `${stuckPendingCount} pending order(s) older than 30 minutes.`,
        count: stuckPendingCount,
        actionUrl: '/orders?status=Pending',
      });
    }

    // 2. high_cancellation
    if (currentOrders > 0) {
      const cancellationRate = (cancelledCount / currentOrders) * 100;
      if (cancellationRate > 20) {
        alerts.push({
          id: 'alert_high_cancellation',
          type: 'high_cancellation',
          severity: 'critical',
          message: `High cancellation rate of ${cancellationRate.toFixed(1)}% in the selected period.`,
          count: cancelledCount,
          actionUrl: '/orders?status=Cancelled',
        });
      }
    }

    // 3. no_active_offers
    if (activeOffers === 0) {
      alerts.push({
        id: 'alert_no_active_offers',
        type: 'no_active_offers',
        severity: 'info',
        message: 'Your restaurant currently has no active offers.',
        count: 0,
        actionUrl: '/offers',
      });
    }

    return {
      restaurantName: restaurant.name,
      kpis: {
        revenue: {
          current: currentRevenue,
          previous: prevRevenue,
          changePercent: this.calculateChangePercent(
            currentRevenue,
            prevRevenue,
          ),
        },
        orders: {
          current: currentOrders,
          previous: prevOrders,
          changePercent: this.calculateChangePercent(currentOrders, prevOrders),
        },
        activeOffers,
        pendingOrders,
      },
      revenueTrend: this.buildRevenueTrend(
        startDate,
        endDate,
        facet.revenueTrend || [],
      ),
      ordersByStatus: this.buildOrdersByStatus(facet.ordersByStatus || []),
      recentOrders,
      alerts,
    };
  }
}
