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
  User,
  UserType,
} from 'src/DB/Models';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import {
  DashboardStatsResponse,
  FulfillmentMethodItem,
  ManagerDashboardStatsResponse,
  RankedItem,
} from './interfaces/dashboard.interface';

const TAX_PERCENTAGE = 14;

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
    @InjectModel(User.name)
    private readonly userModel: Model<UserType>,
  ) {}

  // ─── Date Parsing & Validation ─────────────────────────────────────────────

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

  // ─── Analytics Helpers (Aggregations) ──────────────────────────────────────

  private async getTopProducts(
    matchFilter: Record<string, any>,
  ): Promise<RankedItem[]> {
    const results = await this.orderModel.aggregate([
      { $match: matchFilter },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          name: { $first: '$items.productTitle' },
          count: { $sum: '$items.quantity' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    if (!results || results.length === 0) return [];
    const maxCount = results[0]?.count || 0;

    return results.map((item, index) => ({
      id: item._id ? item._id.toString() : `prod_${index + 1}`,
      rank: index + 1,
      name: item.name || 'Unknown Product',
      count: item.count || 0,
      maxCount,
    }));
  }

  private async getTopCategories(
    matchFilter: Record<string, any>,
  ): Promise<RankedItem[]> {
    const results = await this.orderModel.aggregate([
      { $match: matchFilter },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.productId',
          foreignField: '_id',
          as: 'productDoc',
        },
      },
      { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'categories',
          localField: 'productDoc.category',
          foreignField: '_id',
          as: 'categoryDoc',
        },
      },
      { $unwind: { path: '$categoryDoc', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ['$categoryDoc._id', 'uncategorized'] },
          name: { $first: { $ifNull: ['$categoryDoc.name', 'General'] } },
          count: { $sum: '$items.quantity' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    if (!results || results.length === 0) return [];
    const maxCount = results[0]?.count || 0;

    return results.map((item, index) => ({
      id: item._id ? item._id.toString() : `cat_${index + 1}`,
      rank: index + 1,
      name: item.name || 'General',
      count: item.count || 0,
      maxCount,
    }));
  }

  private async getTopRestaurants(
    matchFilter: Record<string, any>,
  ): Promise<RankedItem[]> {
    const results = await this.orderModel.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$restaurantId',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'restaurants',
          localField: '_id',
          foreignField: '_id',
          as: 'restaurantDoc',
        },
      },
      { $unwind: { path: '$restaurantDoc', preserveNullAndEmptyArrays: true } },
    ]);

    if (!results || results.length === 0) return [];
    const maxCount = results[0]?.count || 0;

    return results.map((item, index) => ({
      id: item._id ? item._id.toString() : `rest_${index + 1}`,
      rank: index + 1,
      name:
        item.restaurantDoc?.name ||
        item.restaurantDoc?.title ||
        'Unknown Restaurant',
      count: item.count || 0,
      maxCount,
    }));
  }

  private async getFulfillmentMethods(
    matchFilter: Record<string, any>,
  ): Promise<FulfillmentMethodItem[]> {
    const results = await this.orderModel.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$deliveryMethod',
          count: { $sum: 1 },
        },
      },
    ]);

    let homeDeliveryCount = 0;
    let storePickupCount = 0;

    for (const r of results) {
      const methodStr = (r._id || '').toString().toLowerCase();
      if (methodStr.includes('home') || methodStr.includes('delivery')) {
        homeDeliveryCount += r.count || 0;
      } else if (methodStr.includes('pickup') || methodStr.includes('store')) {
        storePickupCount += r.count || 0;
      } else {
        homeDeliveryCount += r.count || 0;
      }
    }

    const totalCount = homeDeliveryCount + storePickupCount;
    const homePct =
      totalCount > 0
        ? Number(((homeDeliveryCount / totalCount) * 100).toFixed(1))
        : 0;
    const storePct = totalCount > 0 ? Number((100 - homePct).toFixed(1)) : 0;

    return [
      {
        id: 'home_delivery',
        type: 'Home Delivery',
        name: 'Home Delivery',
        count: homeDeliveryCount,
        percentage: homePct,
      },
      {
        id: 'store_pickup',
        type: 'Store Pickup',
        name: 'Store Pickup',
        count: storePickupCount,
        percentage: storePct,
      },
    ];
  }

  // ─── GET /dashboard/admin ──────────────────────────────────────────────────

  async getAdminDashboard(
    query: DashboardQueryDto,
  ): Promise<DashboardStatsResponse> {
    const { startDate, endDate, prevStartDate, prevEndDate } =
      this.parseAndValidateDates(query);

    // Aggregations on Orders for Current vs Previous periods
    const orderAggregations = await this.orderModel.aggregate([
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
                count: { $sum: 1 },
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
        },
      },
    ]);

    const facet = orderAggregations[0] || {};

    const currentOrders = facet.currentOrdersCount?.[0]?.count || 0;
    const currentRevenue = facet.currentRevenue?.[0]?.total || 0;
    const currentDeliveredOrdersCount = facet.currentRevenue?.[0]?.count || 0;
    const prevOrders = facet.prevOrdersCount?.[0]?.count || 0;
    const prevRevenue = facet.prevRevenue?.[0]?.total || 0;
    const pendingOrders = facet.pendingOrdersCount?.[0]?.count || 0;

    // Active Restaurants & ObjectIds
    const activeRestaurants = await this.restaurantModel.countDocuments({
      isActive: true,
      isDeleted: false,
    });
    const totalRestaurants = await this.restaurantModel.countDocuments({
      isDeleted: { $ne: true },
    });
    const totalUsers = await this.userModel.countDocuments({
      isDeleted: { $ne: true },
    });

    const activeRestaurantDocs = await this.restaurantModel
      .find({ isActive: true, isDeleted: false })
      .select('_id')
      .exec();
    const activeRestaurantIds = activeRestaurantDocs.map((r) => r._id);

    const activeOffers = await this.offerModel.countDocuments({
      status: OfferStatusEnum.ACTIVE,
      isDeleted: false,
      restaurantId: { $in: activeRestaurantIds },
    });

    // Net Profit & Tax Calculations
    const taxDeduction = Number(
      (currentRevenue * (TAX_PERCENTAGE / 100)).toFixed(2),
    );
    const netProfit = Number((currentRevenue - taxDeduction).toFixed(2));
    const avgOrderValue =
      currentDeliveredOrdersCount > 0
        ? Number((currentRevenue / currentDeliveredOrdersCount).toFixed(2))
        : 0;

    // Date range filter for order aggregations
    const dateMatchFilter = {
      createdAt: { $gte: startDate, $lte: endDate },
    };

    const topProducts = await this.getTopProducts(dateMatchFilter);
    const topCategories = await this.getTopCategories(dateMatchFilter);
    const topRestaurants = await this.getTopRestaurants({
      createdAt: { $gte: startDate, $lte: endDate },
      status: 'Delivered',
    });
    const fulfillmentMethods =
      await this.getFulfillmentMethods(dateMatchFilter);

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
        netProfit,
        taxDeduction,
        avgOrderValue,
        totalUsers,
        totalRestaurants,
      },
      topProducts,
      topCategories,
      topRestaurants,
      fulfillmentMethods,
    };
  }

  // ─── GET /dashboard/manager ────────────────────────────────────────────────

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

    // Aggregations on Orders for Manager's Restaurant
    const orderAggregations = await this.orderModel.aggregate([
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
                count: { $sum: 1 },
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
        },
      },
    ]);

    const facet = orderAggregations[0] || {};

    const currentOrders = facet.currentOrdersCount?.[0]?.count || 0;
    const currentRevenue = facet.currentRevenue?.[0]?.total || 0;
    const currentDeliveredOrdersCount = facet.currentRevenue?.[0]?.count || 0;
    const prevOrders = facet.prevOrdersCount?.[0]?.count || 0;
    const prevRevenue = facet.prevRevenue?.[0]?.total || 0;
    const pendingOrders = facet.pendingOrdersCount?.[0]?.count || 0;

    // Active offers for manager's restaurant
    const activeOffers = restaurant.isActive
      ? await this.offerModel.countDocuments({
          restaurantId: restaurantObjId,
          status: OfferStatusEnum.ACTIVE,
          isDeleted: false,
        })
      : 0;

    // Net Profit & Tax Calculations
    const taxDeduction = Number(
      (currentRevenue * (TAX_PERCENTAGE / 100)).toFixed(2),
    );
    const netProfit = Number((currentRevenue - taxDeduction).toFixed(2));
    const avgOrderValue =
      currentDeliveredOrdersCount > 0
        ? Number((currentRevenue / currentDeliveredOrdersCount).toFixed(2))
        : 0;

    // Date range & restaurant filter for manager order aggregations
    const managerDateMatchFilter = {
      restaurantId: restaurantObjId,
      createdAt: { $gte: startDate, $lte: endDate },
    };

    const topProducts = await this.getTopProducts(managerDateMatchFilter);
    const topCategories = await this.getTopCategories(managerDateMatchFilter);
    const fulfillmentMethods = await this.getFulfillmentMethods(
      managerDateMatchFilter,
    );

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
        netProfit,
        taxDeduction,
        avgOrderValue,
      },
      topProducts,
      topCategories,
      fulfillmentMethods,
    };
  }
}
