export interface KpiMetric {
  current: number;
  previous: number;
  changePercent: number;
}

export interface RevenueTrendItem {
  date: string;
  revenue: number;
  orders: number;
}

export interface OrdersByStatus {
  Pending: number;
  Confirmed: number;
  Preparing: number;
  Ready: number;
  'Out For Delivery': number;
  Delivered: number;
  Cancelled: number;
}

export interface RecentOrderItem {
  orderGroupId: string;
  customerName: string;
  restaurantNames: string[];
  finalTotalPrice: number;
  overallStatus: string;
  createdAt: string;
}

export type AlertType =
  | 'stuck_pending'
  | 'high_cancellation'
  | 'no_active_offers'
  | 'inactive_restaurants';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface DashboardAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  count?: number;
  actionUrl?: string;
}

export interface DashboardStatsResponse {
  kpis: {
    revenue: KpiMetric;
    orders: KpiMetric;
    activeOffers: number;
    pendingOrders: number;
    activeRestaurants: number;
  };
  revenueTrend: RevenueTrendItem[];
  ordersByStatus: OrdersByStatus;
  recentOrders: RecentOrderItem[];
  alerts: DashboardAlert[];
}

export interface ManagerDashboardStatsResponse {
  restaurantName: string;
  kpis: {
    revenue: KpiMetric;
    orders: KpiMetric;
    activeOffers: number;
    pendingOrders: number;
  };
  revenueTrend: RevenueTrendItem[];
  ordersByStatus: OrdersByStatus;
  recentOrders: RecentOrderItem[];
  alerts: DashboardAlert[];
}
