export interface KpiMetric {
  current: number;
  previous: number;
  changePercent: number;
}

export interface AdminKpis {
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
}

export interface ManagerKpis {
  revenue: KpiMetric;
  orders: KpiMetric;
  activeOffers: number;
  pendingOrders: number;
  netProfit: number;
  taxDeduction: number;
  avgOrderValue: number;
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
