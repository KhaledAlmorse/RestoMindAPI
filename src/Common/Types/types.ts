export enum RolesEnum {
  ADMIN = 'admin',
  MANAGER = 'manager',
  STAFF = 'staff',
  CUSTOMER = 'customer',
}

export enum GenderEnum {
  MALE = 'male',
  FEMALE = 'female',
}

export enum OtpTypeEnum {
  CONFIRMATION = 'confirmation',
  RESET_PASSWORD = 'reset-password',
}

export enum OfferStatusEnum {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  SOLD_OUT = 'sold_out',
  /**
   * Billing consequence, distinct from CANCELLED (a merchant decision).
   * Reactivation must be able to tell the two apart.
   */
  SUSPENDED = 'suspended',
}

export enum OfferSourceEnum {
  MANUAL = 'manual',
  AI_RECOMMENDATION = 'ai_recommendation',
}

export enum IngredientUnitEnum {
  KG = 'kg',
  LITER = 'liter',
  PIECE = 'piece',
}

export enum SalesSourceEnum {
  CSV_IMPORT = 'csv_import',
  MARKETPLACE_ORDER = 'marketplace_order',
  POS_SYNC = 'pos_sync',
}

export enum OrderStatusEnum {
  PENDING = 'Pending',
  CONFIRMED = 'Confirmed',
  PREPARING = 'Preparing',
  READY = 'Ready',
  OUT_FOR_DELIVERY = 'Out For Delivery',
  DELIVERED = 'Delivered',
  CANCELLED = 'Cancelled',
  /** Online payment started, stock reserved, money not yet confirmed. */
  AWAITING_PAYMENT = 'Awaiting Payment',
  PAYMENT_FAILED = 'Payment Failed',
  /**
   * Fully refunded AFTER delivery. Distinct from CANCELLED: the order was
   * delivered, and calling it cancelled would falsify the fulfilment record
   * and corrupt the sales history the forecasting model trains on.
   */
  REFUNDED = 'Refunded',
  PARTIALLY_REFUNDED = 'Partially Refunded',
}

export enum StockTransactionTypeEnum {
  PURCHASE = 'purchase',
  CONSUMPTION = 'consumption',
  WASTE = 'waste',
  ADJUSTMENT = 'adjustment',
  TRANSFER_IN = 'transfer_in',
  TRANSFER_OUT = 'transfer_out',
  RETURN_TO_SUPPLIER = 'return_to_supplier',
}

export enum OfferDiscountTypeEnum {
  PERCENTAGE = 'percentage',
  FIXED = 'fixed',
}

export enum WasteReasonEnum {
  EXPIRED = 'expired',
  OVERPRODUCTION = 'overproduction',
  PREPARATION_LOSS = 'preparation_loss',
  SPOILED = 'spoiled',
  CUSTOMER_RETURN = 'customer_return',
  DAMAGED = 'damaged',
  INCORRECT_ORDER = 'incorrect_order',
  UNKNOWN = 'unknown',
}

export enum PurchaseOrderStatusEnum {
  DRAFT = 'draft',
  SENT = 'sent',
  RECEIVED = 'received',
  CANCELLED = 'cancelled',
}

export enum ImportTypeEnum {
  SALES_HISTORY = 'sales_history',
  INVENTORY_TRANSACTIONS = 'inventory_transactions',
  RECIPES = 'recipes',
  MENU_ITEMS = 'menu_items',
  INGREDIENTS = 'ingredients',
}

export enum ImportJobStatusEnum {
  PROCESSING = 'processing',
  VALIDATED = 'validated',
  AI_INGEST_PENDING = 'ai_ingest_pending',
  AI_INGEST_FAILED = 'ai_ingest_failed',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum ProductionPlanSourceEnum {
  AI_MODEL = 'ai_model',
  FALLBACK_YESTERDAY = 'fallback_yesterday',
}

export enum PredictionSourceEnum {
  AI_MODEL = 'ai_model',
  FALLBACK_NAIVE = 'fallback_naive',
}

export enum PurchaseOrderSourceEnum {
  MANUAL = 'manual',
  AI_FORECAST = 'ai_forecast',
}

export enum ConfidenceLevelEnum {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum RiskLevelEnum {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum RecommendationTypeEnum {
  APPLY_DISCOUNT = 'apply_discount',
  REDUCE_PURCHASE = 'reduce_purchase',
  STOP_PRODUCTION = 'stop_production',
  TRANSFER_STOCK = 'transfer_stock',
}

export enum RecommendationStatusEnum {
  PENDING = 'pending',
  APPROVED = 'approved',
  EDITED = 'edited',
  DISMISSED = 'dismissed',
}

export enum BusinessTypeEnum {
  RESTAURANT = 'restaurant',
  BAKERY = 'bakery',
  CAFE = 'cafe',
  CATERING = 'catering',
  SUPERMARKET = 'supermarket',
}

export enum PartnershipApplicationStatusEnum {
  PENDING = 'PENDING',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ONBOARDED = 'ONBOARDED',
}

export enum PaymentPurposeEnum {
  SUBSCRIPTION = 'subscription',
  ORDER = 'order',
}

export enum PaymentStatusEnum {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

export enum PaymentMethodEnum {
  CARD = 'card',
  WALLET = 'wallet',
}

export enum RefundStatusEnum {
  REQUESTED = 'requested',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  MANUAL_REQUIRED = 'manual_required',
}

export enum RefundSettlementModeEnum {
  GATEWAY = 'gateway',
  OFFLINE = 'offline',
}
