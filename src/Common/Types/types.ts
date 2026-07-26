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

