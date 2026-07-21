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
