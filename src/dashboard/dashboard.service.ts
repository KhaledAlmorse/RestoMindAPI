import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  OfferStatusEnum,
  PaymentPurposeEnum,
  PaymentStatusEnum,
  PayoutStatusEnum,
  RefundStatusEnum,
} from 'src/Common/Types';
import {
  Offer,
  OfferType,
  Order,
  OrderGroup,
  OrderGroupType,
  OrderType,
  Payment,
  PaymentType,
  Payout,
  PayoutType,
  Refund,
  RefundType,
  Restaurant,
  RestaurantType,
  User,
  UserType,
} from 'src/DB/Models';
import { splitVat } from 'src/Common/Utils';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import {
  DashboardStatsResponse,
  FulfillmentMethodItem,
  ManagerDashboardStatsResponse,
  PlatformKpis,
  RankedItem,
} from './interfaces/dashboard.interface';

const TAX_PERCENTAGE = 14;

/** Money is stored in piasters and reported to the dashboard in EGP. */
const toEgp = (cents: number): number => Number((cents / 100).toFixed(2));

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
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentType>,
    @InjectModel(Refund.name)
    private readonly refundModel: Model<RefundType>,
    @InjectModel(Payout.name)
    private readonly payoutModel: Model<PayoutType>,
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

  // ─── Platform Money (admin only) ───────────────────────────────────────────

  /**
   * What RestoMind itself earns and owes over the window.
   *
   * Deliberately separate from the order aggregations above, which measure the
   * MERCHANTS' money passing through the marketplace. Reading GMV as platform
   * revenue — and then subtracting 14% "tax" from it — is the specific mistake
   * this block exists to replace.
   *
   * Commission is read from `commissionCents` on the order, never re-derived
   * from the restaurant's current rate: each order snapshots the rate it was
   * sold under, and re-deriving would rewrite history the moment an admin
   * changes a commission.
   */
  private async getPlatformKpis(
    startDate: Date,
    endDate: Date,
    prevStartDate: Date,
    prevEndDate: Date,
  ): Promise<PlatformKpis> {
    // Commission accrues when the order is delivered, matching the payout
    // ledger — an order that was never delivered earns nothing.
    const commissionByPeriod = await this.orderModel.aggregate([
      {
        $facet: {
          current: [
            {
              $match: {
                status: 'Delivered',
                deliveredAt: { $gte: startDate, $lte: endDate },
              },
            },
            { $group: { _id: null, cents: { $sum: '$commissionCents' } } },
          ],
          previous: [
            {
              $match: {
                status: 'Delivered',
                deliveredAt: { $gte: prevStartDate, $lt: prevEndDate },
              },
            },
            { $group: { _id: null, cents: { $sum: '$commissionCents' } } },
          ],
        },
      },
    ]);

    const commissionFacet = commissionByPeriod[0] || {};
    const commissionCents = commissionFacet.current?.[0]?.cents || 0;
    const prevCommissionCents = commissionFacet.previous?.[0]?.cents || 0;
    // The stored figure is VAT-inclusive, matching the subscription pricing
    // convention. Only the net part is actually RestoMind's.
    const { netCents, vatCents } = splitVat(commissionCents);

    // Subscription money, split by plan in the same pass — an admin asking
    // "which plan pays for this company" needs the split, not just the total.
    const subscriptionAgg = await this.paymentModel.aggregate([
      {
        $match: {
          purpose: PaymentPurposeEnum.SUBSCRIPTION,
          status: PaymentStatusEnum.PAID,
        },
      },
      {
        $facet: {
          current: [
            { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
            {
              $group: {
                _id: { $ifNull: ['$tier', 'unknown'] },
                label: { $first: { $ifNull: ['$planLabel', '$tier'] } },
                cents: { $sum: '$amountCents' },
                count: { $sum: 1 },
              },
            },
            { $sort: { cents: -1 } },
          ],
          previous: [
            {
              $match: { createdAt: { $gte: prevStartDate, $lt: prevEndDate } },
            },
            { $group: { _id: null, cents: { $sum: '$amountCents' } } },
          ],
        },
      },
    ]);

    const subFacet = subscriptionAgg[0] || {};
    const perPlan: any[] = subFacet.current || [];
    const subscriptionCents = perPlan.reduce((sum, p) => sum + (p.cents || 0), 0);
    const prevSubscriptionCents = subFacet.previous?.[0]?.cents || 0;

    const now = new Date();
    const [
      paidSubscriptions,
      trialSubscriptions,
      refundAgg,
      refundsPending,
      payoutAgg,
    ] = await Promise.all([
      this.restaurantModel.countDocuments({
        isDeleted: false,
        'subscription.currentPeriodEnd': { $gt: now },
      }),
      // A merchant who has since bought a plan is counted as paid above, so
      // the trial count excludes anyone with a live paid period.
      this.restaurantModel.countDocuments({
        isDeleted: false,
        'subscription.trialEndsAt': { $gt: now },
        $or: [
          { 'subscription.currentPeriodEnd': { $exists: false } },
          { 'subscription.currentPeriodEnd': { $lte: now } },
        ],
      }),
      this.refundModel.aggregate([
        {
          $match: {
            status: RefundStatusEnum.SUCCEEDED,
            completedAt: { $gte: startDate, $lte: endDate },
          },
        },
        { $group: { _id: null, cents: { $sum: '$amountCents' } } },
      ]),
      this.refundModel.countDocuments({
        status: {
          $in: [
            RefundStatusEnum.REQUESTED,
            RefundStatusEnum.PROCESSING,
            RefundStatusEnum.MANUAL_REQUIRED,
            RefundStatusEnum.FAILED,
          ],
        },
      }),
      this.payoutModel.aggregate([
        {
          $facet: {
            // Not windowed: a transfer sitting PENDING is money owed right
            // now, and ageing out of the chart would not make it less owed.
            pending: [
              { $match: { status: PayoutStatusEnum.PENDING } },
              {
                $group: {
                  _id: null,
                  cents: { $sum: '$amountCents' },
                  count: { $sum: 1 },
                },
              },
            ],
            completed: [
              {
                $match: {
                  status: PayoutStatusEnum.COMPLETED,
                  completedAt: { $gte: startDate, $lte: endDate },
                },
              },
              { $group: { _id: null, cents: { $sum: '$amountCents' } } },
            ],
          },
        },
      ]),
    ]);

    const payoutFacet = payoutAgg[0] || {};

    return {
      commission: {
        current: toEgp(commissionCents),
        previous: toEgp(prevCommissionCents),
        changePercent: this.calculateChangePercent(
          commissionCents,
          prevCommissionCents,
        ),
      },
      commissionVat: toEgp(vatCents),
      commissionNet: toEgp(netCents),
      subscriptionRevenue: {
        current: toEgp(subscriptionCents),
        previous: toEgp(prevSubscriptionCents),
        changePercent: this.calculateChangePercent(
          subscriptionCents,
          prevSubscriptionCents,
        ),
      },
      totalRevenue: toEgp(commissionCents + subscriptionCents),
      paidSubscriptions,
      trialSubscriptions,
      revenueByPlan: perPlan.map((p) => ({
        tier: String(p._id ?? 'unknown'),
        label: p.label || String(p._id ?? 'Unknown plan'),
        amount: toEgp(p.cents || 0),
        count: p.count || 0,
      })),
      refundedAmount: toEgp(refundAgg?.[0]?.cents || 0),
      refundsPending,
      payoutsPending: toEgp(payoutFacet.pending?.[0]?.cents || 0),
      payoutsPendingCount: payoutFacet.pending?.[0]?.count || 0,
      payoutsCompleted: toEgp(payoutFacet.completed?.[0]?.cents || 0),
    };
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

    const platform = await this.getPlatformKpis(
      startDate,
      endDate,
      prevStartDate,
      prevEndDate,
    );

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
        platform,
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
                // Piasters, snapshotted per order. Summing the stored figure
                // is what keeps this consistent with the payout statement.
                commissionCents: { $sum: '$commissionCents' },
                rateSum: { $sum: '$commissionRate' },
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

    const commissionCharged = toEgp(
      facet.currentRevenue?.[0]?.commissionCents || 0,
    );
    // Averaged over the delivered orders rather than read from the restaurant:
    // the live rate can differ from what these orders were actually sold under.
    const commissionRate =
      currentDeliveredOrdersCount > 0
        ? Number(
            (
              (facet.currentRevenue?.[0]?.rateSum || 0) /
              currentDeliveredOrdersCount
            ).toFixed(4),
          )
        : (restaurant.commissionRate ?? 0);

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
        commissionCharged,
        commissionRate,
        netAfterCommission: Number(
          (currentRevenue - commissionCharged).toFixed(2),
        ),
      },
      topProducts,
      topCategories,
      fulfillmentMethods,
    };
  }
}
