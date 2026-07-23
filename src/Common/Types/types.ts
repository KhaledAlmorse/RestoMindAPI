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
