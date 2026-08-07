export interface KpiMetric {
  current: number;
  previous: number;
  changePercent: number;
}

export interface AdminKpis {
  /** Gross merchandise value — the merchants' money, not RestoMind's. */
  revenue: KpiMetric;
  orders: KpiMetric;
  activeOffers: number;
  pendingOrders: number;
  activeRestaurants: number;
  netProfit: number;
  taxDeduction: number;
  avgOrderValue: number;
  totalUsers: number;
  totalRestaurants: number;
  /** Platform-side money. Absent from a manager dashboard by design. */
  platform: PlatformKpis;
}

/**
 * What RestoMind itself earns and owes, in EGP.
 *
 * GMV is deliberately not part of it: the whole point of this block is that
 * `revenue` above is the merchants' money passing through, while these are the
 * only figures that belong to the platform.
 */
export interface PlatformKpis {
  /** Commission on delivered orders in the window, VAT-inclusive. */
  commission: KpiMetric;
  /** The VAT portion of `commission.current` — owed onward, not earned. */
  commissionVat: number;
  /** Commission excluding VAT: what RestoMind actually keeps. */
  commissionNet: number;
  /** Settled subscription payments in the window. */
  subscriptionRevenue: KpiMetric;
  /** commission.current + subscriptionRevenue.current. */
  totalRevenue: number;
  /** Merchants currently on a paid plan, and on a trial. */
  paidSubscriptions: number;
  trialSubscriptions: number;
  /** Settled subscription revenue in the window, split by plan slug. */
  revenueByPlan: PlanRevenueItem[];
  /** Refunds that succeeded in the window — money returned to customers. */
  refundedAmount: number;
  refundsPending: number;
  /** Recorded but not yet confirmed transfers to merchants. */
  payoutsPending: number;
  payoutsPendingCount: number;
  /** Transfers confirmed in the window. */
  payoutsCompleted: number;
}

export interface PlanRevenueItem {
  /** SubscriptionPlan slug, as snapshotted on the Payment. */
  tier: string;
  label: string;
  amount: number;
  count: number;
}

export interface ManagerKpis {
  revenue: KpiMetric;
  orders: KpiMetric;
  activeOffers: number;
  pendingOrders: number;
  netProfit: number;
  taxDeduction: number;
  avgOrderValue: number;
  /** RestoMind's cut of this restaurant's delivered orders, in EGP. */
  commissionCharged: number;
  /** The rate those orders were sold under, as a fraction. */
  commissionRate: number;
  /**
   * revenue.current − commissionCharged: the merchant's money after the cut.
   *
   * An estimate over the chosen window, not a payable balance — refunds,
   * adjustments and the 7-day hold only exist on the payout statement. The UI
   * links to it rather than restating it here.
   */
  netAfterCommission: number;
}

export interface RankedItem {
  id: string;
  rank: number;
  name: string;
  count: number;
  maxCount: number;
}

export interface FulfillmentMethodItem {
  id: string;
  type: string;
  name: string;
  count: number;
  percentage: number;
}

export interface DashboardStatsResponse {
  kpis: AdminKpis;
  topProducts: RankedItem[];
  topCategories: RankedItem[];
  topRestaurants: RankedItem[];
  fulfillmentMethods: FulfillmentMethodItem[];
}

export interface ManagerDashboardStatsResponse {
  restaurantName: string;
  kpis: ManagerKpis;
  topProducts: RankedItem[];
  topCategories: RankedItem[];
  fulfillmentMethods: FulfillmentMethodItem[];
}
