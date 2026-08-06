import mongoose, { Types } from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import slugify from 'slugify';
import * as bcrypt from 'bcrypt';

// Load environment variables from .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DB_URL =
  process.env.DB_URL ||
  process.env.DB_URL_alt ||
  'mongodb://localhost:27017/Ecommerce_Api_Nestjs';

// ─── 1. Category Schema ────────────────────────────────────────────────────────
const CategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String, required: true },
    image: {
      type: {
        public_id: { type: String, required: true },
        secure_url: { type: String, required: true },
      },
      _id: false,
      required: true,
    },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// ─── 2. User Address & User Schema ──────────────────────────────────────────────
const UserAddressSchema = new mongoose.Schema(
  {
    label: { type: String },
    fullName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    street: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const UserSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, minlength: 3, maxlength: 20 },
    lastName: { type: String, required: true, minlength: 3, maxlength: 20 },
    email: { type: String, required: true, lowercase: true, index: { name: 'unique_email_idx', unique: true } },
    password: { type: String, required: true, minlength: 6 },
    role: {
      type: String,
      enum: ['admin', 'manager', 'staff', 'customer'],
      default: 'customer',
    },
    gender: { type: String, enum: ['male', 'female'] },
    phone: { type: String, required: true, unique: true },
    isEmailVerified: { type: Boolean, default: false },
    DOB: { type: Date },
    passwordChangedAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
    image: {
      type: {
        public_id: { type: String, required: true },
        secure_url: { type: String, required: true },
      },
      _id: false,
      required: false,
    },
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant' },
    isActive: { type: Boolean, default: true },
    employeeCode: { type: String },
    department: { type: String },
    hireDate: { type: Date },
    employmentStatus: { type: String, enum: ['active', 'inactive', 'terminated'], default: 'active' },
    notes: { type: String },
    addresses: { type: [UserAddressSchema], default: [] },
  },
  { timestamps: true },
);

// ─── 3. Restaurant Schema ──────────────────────────────────────────────────────
const RestaurantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    ownerUserId: { type: Types.ObjectId, ref: 'User', required: false, default: null },
    description: { type: String },
    image: {
      type: {
        public_id: { type: String, required: true },
        secure_url: { type: String, required: true },
      },
      _id: false,
      required: false,
    },
    phone: { type: String },
    address: {
      street: { type: String },
      city: { type: String },
      district: { type: String },
      country: { type: String },
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
RestaurantSchema.index(
  { ownerUserId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
RestaurantSchema.index(
  { name: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

// ─── 4. Product Schema ──────────────────────────────────────────────────────────
const ProductSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String, required: true },
    longDescription: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewsCount: { type: Number, default: 0 },
    isBestseller: { type: Boolean, default: false },
    isAvailable: { type: Boolean, default: true },
    image: {
      type: {
        public_id: { type: String, required: true },
        secure_url: { type: String, required: true },
      },
      _id: false,
      required: true,
    },
    category: { type: Types.ObjectId, ref: 'Category', required: true },
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    freshnessWindow: { type: Number, required: true },
    expectedDailySales: { type: Number, default: null, min: 0 },
    tags: { type: [String], default: [] },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);
ProductSchema.index({ restaurantId: 1, title: 1 }, { unique: true });

// ─── 5. Cart Schema ─────────────────────────────────────────────────────────────
const CartItemSchema = new mongoose.Schema(
  {
    offerId: { type: Types.ObjectId, ref: 'Offer', required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
  },
  { _id: false },
);

const CartSchema = new mongoose.Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, unique: true },
    items: { type: [CartItemSchema], default: [] },
  },
  { timestamps: true },
);

// ─── 6. Offer Schema ────────────────────────────────────────────────────────────
const OfferSchema = new mongoose.Schema(
  {
    productId: { type: Types.ObjectId, ref: 'Product', required: true },
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    originalPrice: { type: Number, required: true },
    offerPrice: { type: Number, required: true },
    discountPercentage: { type: Number, required: true, min: 1, max: 100 },
    discountType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
    availableQuantity: { type: Number, required: true, min: 1 },
    remainingQuantity: { type: Number, required: true, min: 0 },
    maxPerCustomer: { type: Number, default: null },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: ['draft', 'scheduled', 'active', 'expired', 'cancelled', 'sold_out'], required: true },
    source: { type: String, enum: ['manual', 'ai_recommendation'], required: true },
    recommendationId: { type: Types.ObjectId, ref: 'Recommendation', default: null },
    featured: { type: Boolean, default: false },
    estimatedWasteReduction: { type: Number, default: null },
    estimatedRevenueRecovery: { type: Number, default: null },
    actualUnitsSold: { type: Number, default: null },
    actualRevenueRecovered: { type: Number, default: null },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);
OfferSchema.index({ productId: 1, status: 1 });
OfferSchema.index({ restaurantId: 1, status: 1 });

// ─── 7. Favorite Schema ─────────────────────────────────────────────────────────
const FavoriteSchema = new mongoose.Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    offerId: { type: Types.ObjectId, ref: 'Offer', required: true },
  },
  { timestamps: true },
);
FavoriteSchema.index({ userId: 1, offerId: 1 }, { unique: true });

// ─── 8. Order & OrderGroup Schema ───────────────────────────────────────────────
const OrderItemSchema = new mongoose.Schema(
  {
    offerId: { type: Types.ObjectId, ref: 'Offer', required: true },
    productId: { type: Types.ObjectId, ref: 'Product', required: true },
    productTitle: { type: String, required: true },
    productImage: { type: String },
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    restaurantName: { type: String, required: true },
    originalPrice: { type: Number, required: true },
    offerPrice: { type: Number, required: true },
    discountPercentage: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    purchasedAt: { type: Date, required: true, default: Date.now },
    lineTotal: { type: Number, required: true },
  },
  { _id: false },
);

const OrderSchema = new mongoose.Schema(
  {
    groupOrderId: { type: Types.ObjectId, ref: 'OrderGroup' },
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    items: { type: [OrderItemSchema], required: true },
    totalOriginalPrice: { type: Number, required: true },
    totalDiscount: { type: Number, required: true },
    finalTotalPrice: { type: Number, required: true },
    totalQuantity: { type: Number, required: true },
    fullName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    emailAddress: { type: String, required: true },
    deliveryMethod: { type: String, enum: ['Home Delivery', 'Store Pickup'], required: true },
    deliveryAddress: {
      type: {
        addressId: { type: String },
        street: { type: String, required: true },
        city: { type: String, required: true },
        country: { type: String, required: true },
      },
      _id: false,
      required: false,
    },
    specialNotes: { type: String },
    paymentMethod: { type: String, enum: ['Cash on Delivery'], required: true, default: 'Cash on Delivery' },
    status: {
      type: String,
      enum: ['Pending', 'Confirmed', 'Preparing', 'Ready', 'Out For Delivery', 'Delivered', 'Cancelled'],
      required: true,
      default: 'Pending',
    },
  },
  { timestamps: true },
);

const OrderGroupSchema = new mongoose.Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    orderIds: { type: [Types.ObjectId], ref: 'Order', required: true },
    fullName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    emailAddress: { type: String, required: true },
    deliveryMethod: { type: String, enum: ['Home Delivery', 'Store Pickup'], required: true },
    deliveryAddress: {
      type: {
        addressId: { type: String },
        street: { type: String, required: true },
        city: { type: String, required: true },
        country: { type: String, required: true },
      },
      _id: false,
      required: false,
    },
    specialNotes: { type: String },
    paymentMethod: { type: String, enum: ['Cash on Delivery'], required: true, default: 'Cash on Delivery' },
    totalOriginalPrice: { type: Number, required: true },
    totalDiscount: { type: Number, required: true },
    finalTotalPrice: { type: Number, required: true },
    totalQuantity: { type: Number, required: true },
    overallStatus: { type: String, default: 'Pending' },
  },
  { timestamps: true },
);

// ─── 9. Ingredient & Recipe Schema ──────────────────────────────────────────────
const RecipeIngredientSchema = new mongoose.Schema(
  {
    ingredientId: { type: Types.ObjectId, ref: 'Ingredient', required: true },
    quantityPerPortion: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: ['kg', 'liter', 'piece'], required: true },
    yieldPercentage: { type: Number, default: 100, min: 0, max: 100 },
  },
  { _id: false },
);

const IngredientSchema = new mongoose.Schema(
  {
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    ingredientCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    unit: { type: String, enum: ['kg', 'liter', 'piece'], required: true },
    shelfLifeDays: { type: Number, required: true, min: 0 },
    minimumStock: { type: Number, default: 0, min: 0 },
    safetyStock: { type: Number, default: 0, min: 0 },
    supplierId: { type: Types.ObjectId, ref: 'Supplier', default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const RecipeSchema = new mongoose.Schema(
  {
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    productId: { type: Types.ObjectId, ref: 'Product', required: true },
    ingredients: { type: [RecipeIngredientSchema], required: true, default: [] },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// ─── 10. Sales Transaction Schema ────────────────────────────────────────────────
const SalesTransactionSchema = new mongoose.Schema(
  {
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    productId: { type: Types.ObjectId, ref: 'Product', required: true },
    date: { type: Date, required: true, default: Date.now },
    quantitySold: { type: Number, required: true, min: 1 },
    basePrice: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    promotionActive: { type: Boolean, default: false },
    featured: { type: Boolean, default: false },
    stockoutMinutes: { type: Number, default: 0, min: 0 },
    cancelledOrders: { type: Number, default: 0, min: 0 },
    returnedOrders: { type: Number, default: 0, min: 0 },
    salesChannel: { type: String, default: 'marketplace' },
    source: { type: String, enum: ['csv_import', 'marketplace_order', 'pos_sync'], required: true },
    importJobId: { type: Types.ObjectId, ref: 'ImportJob', default: null },
    offerId: { type: Types.ObjectId, ref: 'Offer', default: null },
    orderId: { type: Types.ObjectId, ref: 'Order', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// ─── 11. Supplier Schema ────────────────────────────────────────────────────────
const SupplierSchema = new mongoose.Schema(
  {
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    leadTimeDays: { type: Number, required: true, default: 1, min: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// ─── 12. Inventory Batch Schema ────────────────────────────────────────────────
const InventoryBatchSchema = new mongoose.Schema(
  {
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    ingredientId: { type: Types.ObjectId, ref: 'Ingredient', required: true },
    batchNumber: { type: String, required: true, trim: true },
    quantityRemaining: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, required: true, min: 0 },
    expiryDate: { type: Date, required: true },
    receivedDate: { type: Date, required: true, default: Date.now },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// ─── 13. Stock Transaction Schema ──────────────────────────────────────────────
const StockTransactionSchema = new mongoose.Schema(
  {
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    ingredientId: { type: Types.ObjectId, ref: 'Ingredient', required: true },
    batchId: { type: Types.ObjectId, ref: 'InventoryBatch', default: null },
    transactionType: {
      type: String,
      enum: ['purchase', 'consumption', 'waste', 'adjustment', 'transfer_in', 'transfer_out', 'return_to_supplier'],
      required: true,
    },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: ['kg', 'liter', 'piece'], required: true },
    date: { type: Date, required: true, default: Date.now },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// ─── 14. Waste Event Schema ─────────────────────────────────────────────────────
const WasteEventSchema = new mongoose.Schema(
  {
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    ingredientId: { type: Types.ObjectId, ref: 'Ingredient', required: true },
    batchId: { type: Types.ObjectId, ref: 'InventoryBatch', default: null },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: ['kg', 'liter', 'piece'], required: true },
    wasteReason: {
      type: String,
      enum: ['expired', 'overproduction', 'preparation_loss', 'spoiled', 'customer_return', 'damaged', 'incorrect_order', 'unknown'],
      required: true,
    },
    estimatedCost: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, default: Date.now },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// ─── 15. Purchase Order Schema ──────────────────────────────────────────────────
const PurchaseOrderItemSchema = new mongoose.Schema(
  {
    ingredientId: { type: Types.ObjectId, ref: 'Ingredient', required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: ['kg', 'liter', 'piece'], required: true },
    unitCost: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const PurchaseOrderSchema = new mongoose.Schema(
  {
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    supplierId: { type: Types.ObjectId, ref: 'Supplier', required: true },
    items: { type: [PurchaseOrderItemSchema], required: true, default: [] },
    status: {
      type: String,
      enum: ['draft', 'sent', 'received', 'cancelled'],
      required: true,
      default: 'draft',
    },
    source: { type: String, enum: ['manual', 'ai_forecast'], default: 'manual' },
    expectedDeliveryDate: { type: Date, default: null },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// ─── 16. Import Job Schema ──────────────────────────────────────────────────────
const ImportJobSchema = new mongoose.Schema(
  {
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    uploadedBy: { type: Types.ObjectId, ref: 'User', required: true },
    importType: { type: String, enum: ['sales_history', 'inventory_transactions', 'recipes', 'menu_items', 'ingredients'], required: true },
    fileName: { type: String, required: true },
    columnMapping: { type: Object, default: {} },
    rawRows: { type: [Array], default: [] },
    status: {
      type: String,
      enum: ['processing', 'validated', 'ai_ingest_pending', 'ai_ingest_failed', 'completed', 'failed'],
      required: true,
      default: 'processing',
    },
    totalRows: { type: Number, default: 0 },
    validRows: { type: Number, default: 0 },
    invalidRows: { type: Number, default: 0 },
    errors: {
      type: [
        new mongoose.Schema(
          {
            row: { type: Number, required: true },
            column: { type: String },
            message: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    aiIngestAttempts: { type: Number, default: 0 },
    aiIngestLastError: { type: String },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// ─── 17. Prediction & Production Plan Schemas ────────────────────────────────
const DailyBreakdownItemSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    predictedQuantity: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const PredictionSchema = new mongoose.Schema(
  {
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    productId: { type: Types.ObjectId, ref: 'Product', required: true },
    modelVersionId: { type: String, required: true },
    targetWeek: { type: String, required: true },
    predictedOrders: { type: Number, required: true },
    confidence: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    source: { type: String, enum: ['ai_model', 'fallback_naive'], required: true },
    featuresUsed: { type: Object, default: {} },
    factors: { type: Array, default: [] },
    dailyBreakdown: { type: [DailyBreakdownItemSchema], default: [] },
    actualOrders: { type: Number, default: null },
    errorAbs: { type: Number, default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const ProductionPlanItemSchema = new mongoose.Schema(
  {
    productId: { type: Types.ObjectId, ref: 'Product', required: true },
    recommendedQty: { type: Number, required: true },
    lowerBound: { type: Number, default: 0 },
    upperBound: { type: Number, default: 0 },
    confidence: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    source: { type: String, enum: ['ai_model', 'fallback_yesterday'], required: true },
    factors: { type: Array, default: [] },
    actualProducedQty: { type: Number, default: null },
  },
  { _id: false },
);

const DailyProductionPlanSchema = new mongoose.Schema(
  {
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    date: { type: String, required: true },
    totalRecommendedQty: { type: Number, required: true },
    items: { type: [ProductionPlanItemSchema], default: [] },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// ─── 18. Waste Report Schema ───────────────────────────────────────────────────
const WasteReportSchema = new mongoose.Schema(
  {
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    predictionId: { type: Types.ObjectId, ref: 'Prediction', default: null },
    ingredientId: { type: Types.ObjectId, ref: 'Ingredient', required: true },
    expectedConsumption: { type: Number, required: true },
    usableAvailableStock: { type: Number, required: true },
    expectedSurplus: { type: Number, required: true },
    riskLevel: { type: String, enum: ['low', 'medium', 'high'], required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// ─── 19. Recommendation Schema ────────────────────────────────────────────────
const RecommendationSchema = new mongoose.Schema(
  {
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant', required: true },
    wasteReportId: { type: Types.ObjectId, ref: 'WasteReport', default: null },
    productId: { type: Types.ObjectId, ref: 'Product', required: true },
    type: {
      type: String,
      enum: ['apply_discount', 'reduce_purchase', 'stop_production', 'transfer_stock'],
      required: true,
    },
    suggestedValue: { type: Number, default: null },
    targetRestaurantId: { type: Types.ObjectId, ref: 'Restaurant', default: null },
    gptExplanation: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'approved', 'edited', 'dismissed'],
      default: 'pending',
      required: true,
    },
    reviewedBy: { type: Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// ─── 20. OTP Schema ──────────────────────────────────────────────────────────
const OtpSchema = new mongoose.Schema(
  {
    otp: { type: String, required: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['confirmation', 'reset-password'], required: true },
    expiresAt: { type: Date, required: true },
    isUsed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// ─── 21. Partnership Application Schema ───────────────────────────────────────
const PartnershipApplicationSchema = new mongoose.Schema(
  {
    businessName: { type: String, required: true },
    businessType: {
      type: String,
      enum: ['bakery', 'restaurant', 'cafe', 'patisserie', 'supermarket', 'hotel', 'catering', 'other'],
      required: true,
    },
    description: { type: String },
    estimatedOrdersPerDay: { type: Number },
    estimatedWasteKgPerDay: { type: Number },
    ownerFirstName: { type: String, required: true },
    ownerLastName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    city: { type: String, required: true },
    district: { type: String },
    street: { type: String },
    website: { type: String },
    facebookPage: { type: String },
    instagramPage: { type: String },
    operatingHours: { type: Object },
    commercialRegistration: { type: String },
    taxId: { type: String },
    notes: { type: String },
    status: {
      type: String,
      enum: ['pending', 'under_review', 'approved', 'rejected'],
      default: 'pending',
    },
    rejectionReason: { type: String },
    reviewedBy: { type: Types.ObjectId, ref: 'User' },
    approvedBy: { type: Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    userId: { type: Types.ObjectId, ref: 'User' },
    restaurantId: { type: Types.ObjectId, ref: 'Restaurant' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
PartnershipApplicationSchema.index({ email: 1, status: 1 });
PartnershipApplicationSchema.index({ status: 1, createdAt: -1 });

// ─── 22. Revoked Token Schema ──────────────────────────────────────────────────
const RevokedTokenSchema = new mongoose.Schema(
  {
    tokenId: { type: String, required: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    expiryTime: { type: Date, required: true },
  },
  { timestamps: true },
);

// ─── Register Models ──────────────────────────────────────────────────────────
const OtpModel = mongoose.models.Otp || mongoose.model('Otp', OtpSchema);
const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);
const RestaurantModel = mongoose.models.Restaurant || mongoose.model('Restaurant', RestaurantSchema);
const CategoryModel = mongoose.models.Category || mongoose.model('Category', CategorySchema);
const ProductModel = mongoose.models.Product || mongoose.model('Product', ProductSchema);
const CartModel = mongoose.models.Cart || mongoose.model('Cart', CartSchema);
const OfferModel = mongoose.models.Offer || mongoose.model('Offer', OfferSchema);
const FavoriteModel = mongoose.models.Favorite || mongoose.model('Favorite', FavoriteSchema);
const IngredientModel = mongoose.models.Ingredient || mongoose.model('Ingredient', IngredientSchema);
const RecipeModel = mongoose.models.Recipe || mongoose.model('Recipe', RecipeSchema);
const SalesTransactionModel = mongoose.models.SalesTransaction || mongoose.model('SalesTransaction', SalesTransactionSchema);
const OrderModel = mongoose.models.Order || mongoose.model('Order', OrderSchema);
const OrderGroupModel = mongoose.models.OrderGroup || mongoose.model('OrderGroup', OrderGroupSchema);
const SupplierModel = mongoose.models.Supplier || mongoose.model('Supplier', SupplierSchema);
const InventoryBatchModel = mongoose.models.InventoryBatch || mongoose.model('InventoryBatch', InventoryBatchSchema);
const StockTransactionModel = mongoose.models.StockTransaction || mongoose.model('StockTransaction', StockTransactionSchema);
const WasteEventModel = mongoose.models.WasteEvent || mongoose.model('WasteEvent', WasteEventSchema);
const PurchaseOrderModel = mongoose.models.PurchaseOrder || mongoose.model('PurchaseOrder', PurchaseOrderSchema);
const ImportJobModel = mongoose.models.ImportJob || mongoose.model('ImportJob', ImportJobSchema);
const PredictionModel = mongoose.models.Prediction || mongoose.model('Prediction', PredictionSchema);
const DailyProductionPlanModel = mongoose.models.DailyProductionPlan || mongoose.model('DailyProductionPlan', DailyProductionPlanSchema);
const WasteReportModel = mongoose.models.WasteReport || mongoose.model('WasteReport', WasteReportSchema);
const RecommendationModel = mongoose.models.Recommendation || mongoose.model('Recommendation', RecommendationSchema);
const PartnershipApplicationModel = mongoose.models.PartnershipApplication || mongoose.model('PartnershipApplication', PartnershipApplicationSchema);
const RevokeTokenModel = mongoose.models.RevokedToken || mongoose.model('RevokedToken', RevokedTokenSchema);

const extraCategoryNames = [
  { name: 'Cakes', desc: 'Layered celebration cakes, cheesecakes, and decadent chocolate gateaux.', img: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=800&q=80' },
  { name: 'Muffins', desc: 'Soft, fluffy muffins in blueberry, chocolate chip, and banana walnut.', img: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=800&q=80' },
  { name: 'Bagels', desc: 'Chewy New-York style bagels with premium cream cheese spreads.', img: 'https://images.unsplash.com/photo-1559563458-527698bf5295?auto=format&fit=crop&w=800&q=80' },
  { name: 'Donuts', desc: 'Light, airy donuts glazed, filled, and topped with creative flavours.', img: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=800&q=80' },
  { name: 'Tarts', desc: 'Buttery tart shells filled with fresh fruit, custard, or rich chocolate.', img: 'https://images.unsplash.com/photo-1587248720654-f1b5f15b3df7?auto=format&fit=crop&w=800&q=80' },
  { name: 'Pancakes', desc: 'Fluffy American-style pancakes with maple syrup and fresh toppings.', img: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?auto=format&fit=crop&w=800&q=80' },
  { name: 'Waffles', desc: 'Crispy golden waffles with whipped cream, berries, and chocolate drizzle.', img: 'https://images.unsplash.com/photo-1562376552-0d160a2f238d?auto=format&fit=crop&w=800&q=80' },
  { name: 'Smoothies', desc: 'Fresh blended fruit smoothies, protein shakes, and green boosters.', img: 'https://images.unsplash.com/photo-1556881286-fc6915169721?auto=format&fit=crop&w=800&q=80' },
  { name: 'Salads', desc: 'Crisp garden salads, grain bowls, and protein-packed meal salads.', img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80' },
  { name: 'Soups', desc: 'Hearty homemade soups, creamy bisques, and traditional lentil soup.', img: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=800&q=80' },
  { name: 'Pizzas', desc: 'Wood-fired thin-crust pizzas with premium Italian toppings.', img: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=800&q=80' },
  { name: 'Pasta', desc: 'Fresh homemade pasta with classic sauces and seasonal ingredients.', img: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?auto=format&fit=crop&w=800&q=80' },
  { name: 'Rice Dishes', desc: 'Flavourful rice bowls, biryanis, and Egyptian-style seasoned rice.', img: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80' },
  { name: 'Seafood', desc: 'Fresh catch of the day, grilled fish, and shrimp specialties.', img: 'https://images.unsplash.com/photo-1559847844-5315695dadae?auto=format&fit=crop&w=800&q=80' },
  { name: 'Appetizers', desc: 'Crispy starters, dips, spring rolls, and finger-licking small plates.', img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80' },
  { name: 'Grilled Items', desc: 'Char-grilled meats, kebabs, and smoky barbecue specialties.', img: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=800&q=80' },
];

const categoriesData = [
  {
    _id: new Types.ObjectId(),
    name: 'Bread',
    description: 'Stone-baked, artisanal, and traditional Egyptian flatbreads baked fresh hourly.',
    image: {
      public_id: 'resto_seed/categories/bread',
      secure_url: 'https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&w=800&q=80',
    },
    isDeleted: false,
  },
  {
    _id: new Types.ObjectId(),
    name: 'Pastry',
    description: 'Flaky, buttery pastries, hand-laminated croissants, and traditional Egyptian layered feteer.',
    image: {
      public_id: 'resto_seed/categories/pastry',
      secure_url: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=800&q=80',
    },
    isDeleted: false,
  },
  {
    _id: new Types.ObjectId(),
    name: 'Cookies',
    description: 'Rich shortbreads, stuffed traditional Eid treats, and freshly baked sweet cookies.',
    image: {
      public_id: 'resto_seed/categories/cookies',
      secure_url: 'https://images.unsplash.com/photo-1511018556340-d16986a1c194?auto=format&fit=crop&w=800&q=80',
    },
    isDeleted: false,
  },
  {
    _id: new Types.ObjectId(),
    name: 'Desserts',
    description: 'Traditional oriental desserts, sweet semolina cakes, kunafa, and sweet baked treats.',
    image: {
      public_id: 'resto_seed/categories/desserts',
      secure_url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=800&q=80',
    },
    isDeleted: false,
  },
  {
    _id: new Types.ObjectId(),
    name: 'Beverages',
    description: 'Freshly brewed specialty coffees, natural fruit juices, iced teas, and refreshing drinks.',
    image: {
      public_id: 'resto_seed/categories/beverages',
      secure_url: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=800&q=80',
    },
    isDeleted: false,
  },
  {
    _id: new Types.ObjectId(),
    name: 'Sandwiches',
    description: 'Gourmet savory sandwiches, stuffed Egyptian baladi pockets, and toasted paninis.',
    image: {
      public_id: 'resto_seed/categories/sandwiches',
      secure_url: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=800&q=80',
    },
    isDeleted: false,
  },
  ...extraCategoryNames.map((c) => ({
    _id: new Types.ObjectId(),
    name: c.name,
    description: c.desc,
    image: { public_id: `resto_seed/categories/${c.name.toLowerCase().replace(/\s+/g, '_')}`, secure_url: c.img },
    isDeleted: false,
  })),
];

async function seed() {
  try {
    console.log('🌱 Connecting to MongoDB database:', DB_URL);
    await mongoose.connect(DB_URL);
    console.log('✅ Connected to MongoDB successfully.');

    console.log('🧹 Clearing existing data...');
    await PartnershipApplicationModel.deleteMany({});
    await RevokeTokenModel.deleteMany({});
    await OtpModel.deleteMany({});
    await RecommendationModel.deleteMany({});
    await WasteReportModel.deleteMany({});
    await DailyProductionPlanModel.deleteMany({});
    await PredictionModel.deleteMany({});
    await ImportJobModel.deleteMany({});
    await PurchaseOrderModel.deleteMany({});
    await WasteEventModel.deleteMany({});
    await StockTransactionModel.deleteMany({});
    await InventoryBatchModel.deleteMany({});
    await SupplierModel.deleteMany({});
    await OrderGroupModel.deleteMany({});
    await OrderModel.deleteMany({});
    await SalesTransactionModel.deleteMany({});
    await RecipeModel.deleteMany({});
    await IngredientModel.deleteMany({});
    await CartModel.deleteMany({});
    await FavoriteModel.deleteMany({});
    await OfferModel.deleteMany({});
    await ProductModel.deleteMany({});
    await CategoryModel.deleteMany({});
    await RestaurantModel.deleteMany({});
    await UserModel.deleteMany({});
    console.log('✅ Database cleared.');

    // ─── 1. Seed Core Users ─────────────────────────────────────────────────────
    console.log('👤 Seeding core users...');
    const hashedPassword = bcrypt.hashSync('Admin@123', 10);
    const adminUser = await UserModel.create({
      firstName: 'RestoMind',
      lastName: 'Admin',
      email: 'admin@restomind.com',
      password: hashedPassword,
      role: 'admin',
      gender: 'male',
      phone: '+201000000000',
      isEmailVerified: true,
      DOB: new Date('1990-01-01'),
      isDeleted: false,
    });

    const customerHashedPassword = bcrypt.hashSync('Customer@123', 10);
    const customerUser = await UserModel.create({
      firstName: 'Sara',
      lastName: 'Ahmed',
      email: 'sara@example.com',
      password: customerHashedPassword,
      role: 'customer',
      gender: 'female',
      phone: '+201000000002',
      isEmailVerified: true,
      DOB: new Date('1995-06-15'),
      isDeleted: false,
    });

    const managerHashedPassword = bcrypt.hashSync('Manager@123', 10);
    const managerUser = await UserModel.create({
      firstName: 'Omar',
      lastName: 'Khaled',
      email: 'manager@restomind.com',
      password: managerHashedPassword,
      role: 'manager',
      gender: 'male',
      phone: '+201000000003',
      isEmailVerified: true,
      DOB: new Date('1988-03-20'),
      employeeCode: 'EMP-MGR-001',
      department: 'Store Operations',
      hireDate: new Date('2024-01-15'),
      employmentStatus: 'active',
      isActive: true,
      isDeleted: false,
    });

    const staffHashedPassword = bcrypt.hashSync('Staff@123', 10);
    const staffUser = await UserModel.create({
      firstName: 'Nour',
      lastName: 'Mahmoud',
      email: 'staff@restomind.com',
      password: staffHashedPassword,
      role: 'staff',
      gender: 'female',
      phone: '+201000000004',
      isEmailVerified: true,
      DOB: new Date('1995-07-10'),
      employeeCode: 'EMP-STF-001',
      department: 'Kitchen',
      hireDate: new Date('2024-06-01'),
      employmentStatus: 'active',
      isActive: true,
      isDeleted: false,
    });

    // ─── 2. Seed Default Restaurant ──────────────────────────────────────────────
    console.log('🏪 Seeding default restaurant...');
    const restaurant = await RestaurantModel.create({
      name: 'RestoMind Bakery & Cafe',
      ownerUserId: adminUser._id,
      description: 'Artisanal bakery and cafe serving fresh breads, pastries, sandwiches, and beverages.',
      image: {
        public_id: 'resto_seed/restaurants/default_bakery',
        secure_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80',
      },
      phone: '+201000000001',
      address: { street: '1 Nile Corniche', city: 'Cairo', district: 'Zamalek', country: 'Egypt' },
      isActive: true,
      isDeleted: false,
    });

    // ─── 3. Seed Extra Users (Total Users >= 24) ─────────────────────────────────
    const userNames = [
      { first: 'Ahmed', last: 'Hassan' }, { first: 'Mona', last: 'Ali' }, { first: 'Khaled', last: 'Youssef' },
      { first: 'Nadia', last: 'Farouk' }, { first: 'Omar', last: 'El-Sayed' }, { first: 'Dina', last: 'Shawky' },
      { first: 'Tamer', last: 'Nabil' }, { first: 'Laila', last: 'Rashad' }, { first: 'Hossam', last: 'Gamal' },
      { first: 'Rania', last: 'Kamel' }, { first: 'Mahmoud', last: 'Zidan' }, { first: 'Nour', last: 'El-Din' },
      { first: 'Samir', last: 'Abdou' }, { first: 'Heba', last: 'Saleh' }, { first: 'Yasser', last: 'Lotfy' },
      { first: 'Ghada', last: 'Wahid' }, { first: 'Shady', last: 'Mansour' }, { first: 'Mariam', last: 'Fawzy' },
      { first: 'Wael', last: 'Ezzat' }, { first: 'Salma', last: 'Hany' },
    ];
    const allUserIds = [adminUser._id, customerUser._id, managerUser._id, staffUser._id];
    const extraUsers: any[] = [];
    for (let i = 0; i < userNames.length; i++) {
      const u = userNames[i];
      const isStaffOrMgr = i % 4 === 0 || i % 5 === 0;
      extraUsers.push({
        firstName: u.first,
        lastName: u.last,
        email: `${u.first.toLowerCase()}.${u.last.toLowerCase()}@example.com`,
        password: bcrypt.hashSync('User@123', 10),
        role: i % 4 === 0 ? 'manager' : i % 5 === 0 ? 'staff' : 'customer',
        gender: i % 2 === 0 ? 'male' : 'female',
        phone: `+20101${String(10000000 + i).slice(0, 8)}`,
        isEmailVerified: true,
        DOB: new Date(1985 + (i % 20), i % 12, (i % 28) + 1),
        isActive: true,
        ...(isStaffOrMgr
          ? {
              employeeCode: `EMP-EXT-${100 + i}`,
              department: i % 2 === 0 ? 'Operations' : 'Service',
              hireDate: new Date(2024, i % 12, 1),
              employmentStatus: 'active',
            }
          : {}),
        isDeleted: false,
      });
    }
    const insertedUsers = await UserModel.insertMany(extraUsers);
    insertedUsers.forEach((u) => allUserIds.push(u._id));
    console.log(`✅ Users seeded: ${allUserIds.length}`);

    // ─── 4. Seed Extra Restaurants (Total Restaurants >= 21) ──────────────────────
    const restNames = [
      'Cairo Bakes', 'Alexandria Patisserie', 'Giza Grills', 'Luxor Treats', 'Aswan Delights',
      'Nile Bistro', 'Zamalek Cafe', 'Heliopolis Bakery', 'Maadi Eatery', 'Downtown Diner',
      'Garden City Kitchen', 'Mohandeseen Bites', 'Nasr City Platters', 'Shorouk Sweets',
      '6th October Cafe', 'Sheikh Zayed Bistro', 'Faisal Bakery', 'Haram Pastry',
      'Tagamoa Grill', 'Rehab Deli',
    ];
    const allRestaurantIds = [restaurant._id];
    const extraRests = restNames.map((n, i) => ({
      name: n,
      ownerUserId: allUserIds[(i + 1) % allUserIds.length],
      description: `Premium ${n.toLowerCase()} serving fresh food daily.`,
      image: {
        public_id: `resto_seed/restaurants/${slugify(n, { lower: true, strict: true })}`,
        secure_url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80',
      },
      phone: `+20102${String(20000000 + i).slice(0, 8)}`,
      address: { street: `${i + 1} Main St`, city: 'Cairo', district: 'Central', country: 'Egypt' },
      isActive: true,
      isDeleted: false,
    }));
    const insertedRests = await RestaurantModel.insertMany(extraRests);
    insertedRests.forEach((r) => allRestaurantIds.push(r._id));
    console.log(`✅ Restaurants seeded: ${allRestaurantIds.length}`);

    // Store restaurant lookup list
    const allRestaurants = [
      { _id: restaurant._id, name: restaurant.name, ownerUserId: adminUser._id },
      ...insertedRests.map((r) => ({ _id: r._id, name: r.name, ownerUserId: r.ownerUserId })),
    ];

    // Link managerUser to default restaurant
    const managerRestaurantId = allRestaurantIds[0];
    await UserModel.findByIdAndUpdate(managerUser._id, { restaurantId: managerRestaurantId });

    // ─── 5. Seed Categories (Total Categories >= 22) ──────────────────────────────
    console.log('📦 Seeding categories...');
    const insertedCategories = await CategoryModel.insertMany(categoriesData);
    const catMap = new Map<string, Types.ObjectId>();
    insertedCategories.forEach((cat) => catMap.set(cat.name, cat._id));
    console.log(`✅ Categories seeded: ${insertedCategories.length}`);

    // ─── 6. Seed Products Across ALL Restaurants ─────────────────────────────────
    console.log('🥖 Seeding products across all restaurants...');
    const productsData: any[] = [
      {
        title: 'Baladi Bread',
        slug: slugify('Baladi Bread', { lower: true, strict: true }),
        description: 'Stone-baked Egyptian flatbread, warm every hour',
        longDescription: 'Our traditional Baladi Bread is stone-baked at extremely high temperatures to create the perfect pocket.',
        price: 15,
        rating: 4.9,
        reviewsCount: 148,
        isBestseller: true,
        isAvailable: true,
        freshnessWindow: 6,
        tags: ['Daily Fresh', 'Stone-baked', 'Bestseller'],
        image: { public_id: 'resto_seed/products/baladi_bread', secure_url: 'https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&w=800&q=80' },
        category: catMap.get('Bread'),
        restaurantId: restaurant._id,
        isDeleted: false,
      },
      {
        title: 'Artisanal Sourdough Loaf',
        slug: slugify('Artisanal Sourdough Loaf', { lower: true, strict: true }),
        description: 'Naturally leavened sourdough bread with caramelized crust',
        longDescription: 'Baked with an active wild yeast starter. Features a thick, caramelized crust and an open, chewy crumb.',
        price: 95,
        rating: 4.8,
        reviewsCount: 92,
        isBestseller: false,
        isAvailable: true,
        freshnessWindow: 24,
        tags: ['Sourdough', 'Artisanal'],
        image: { public_id: 'resto_seed/products/sourdough_loaf', secure_url: 'https://images.unsplash.com/photo-1586444248902-2f64eddc13df?auto=format&fit=crop&w=800&q=80' },
        category: catMap.get('Bread'),
        restaurantId: restaurant._id,
        isDeleted: false,
      },
      {
        title: 'Butter Croissant Box',
        slug: slugify('Butter Croissant Box', { lower: true, strict: true }),
        description: '6 pieces, 81 laminated layers each',
        longDescription: 'Laminated with Normandy AOC butter for maximum puffiness.',
        price: 150,
        rating: 4.9,
        reviewsCount: 387,
        isBestseller: true,
        isAvailable: true,
        freshnessWindow: 12,
        tags: ['Daily Fresh', 'Laminated', 'Bestseller'],
        image: { public_id: 'resto_seed/products/croissant_box', secure_url: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=800&q=80' },
        category: catMap.get('Pastry'),
        restaurantId: restaurant._id,
        isDeleted: false,
      },
      {
        title: 'Feteer Meshaltet',
        slug: slugify('Feteer Meshaltet', { lower: true, strict: true }),
        description: '27 hand-stretched layers served with honey & cream',
        longDescription: 'A legendary Egyptian pastry made of 27 paper-thin layers of hand-stretched dough.',
        price: 85,
        rating: 5.0,
        reviewsCount: 219,
        isBestseller: true,
        isAvailable: true,
        freshnessWindow: 8,
        tags: ['Daily Fresh', 'Traditional', 'Bestseller'],
        image: { public_id: 'resto_seed/products/feteer_meshaltet', secure_url: 'https://images.unsplash.com/photo-1608686207856-001b95cf60ca?auto=format&fit=crop&w=800&q=80' },
        category: catMap.get('Pastry'),
        restaurantId: restaurant._id,
        isDeleted: false,
      },
      {
        title: 'Semolina Basbousa Tray',
        slug: slugify('Semolina Basbousa Tray', { lower: true, strict: true }),
        description: 'Sweet semolina cake soaked in rosewater syrup',
        longDescription: 'Traditional Egyptian Basbousa made with fine semolina, yogurt, and coconut.',
        price: 110,
        rating: 4.9,
        reviewsCount: 115,
        isBestseller: true,
        isAvailable: true,
        freshnessWindow: 48,
        tags: ['Traditional', 'Sweet', 'Bestseller'],
        image: { public_id: 'resto_seed/products/basbousa', secure_url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=800&q=80' },
        category: catMap.get('Desserts'),
        restaurantId: restaurant._id,
        isDeleted: false,
      },
      {
        title: 'Cream Kunafa with Pistachio',
        slug: slugify('Cream Kunafa with Pistachio', { lower: true, strict: true }),
        description: 'Crispy shredded pastry with fresh cream & pistachios',
        longDescription: 'Golden crispy shredded phyllo dough stuffed with velvety fresh cream.',
        price: 140,
        rating: 5.0,
        reviewsCount: 310,
        isBestseller: true,
        isAvailable: true,
        freshnessWindow: 24,
        tags: ['Oriental', 'Pistachio', 'Bestseller'],
        image: { public_id: 'resto_seed/products/kunafa', secure_url: 'https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?auto=format&fit=crop&w=800&q=80' },
        category: catMap.get('Desserts'),
        restaurantId: restaurant._id,
        isDeleted: false,
      },
      {
        title: 'Iced Spanish Latte',
        slug: slugify('Iced Spanish Latte', { lower: true, strict: true }),
        description: 'Espresso with condensed milk and fresh cold milk over ice',
        longDescription: 'Double shot of rich espresso mixed with sweetened condensed milk and cold fresh milk.',
        price: 65,
        rating: 4.8,
        reviewsCount: 280,
        isBestseller: true,
        isAvailable: true,
        freshnessWindow: 2,
        tags: ['Coffee', 'Iced', 'Sweet', 'Bestseller'],
        image: { public_id: 'resto_seed/products/spanish_latte', secure_url: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=800&q=80' },
        category: catMap.get('Beverages'),
        restaurantId: restaurant._id,
        isDeleted: false,
      },
      {
        title: 'Smoked Turkey & Emmental Panini',
        slug: slugify('Smoked Turkey & Emmental Panini', { lower: true, strict: true }),
        description: 'Toasted sourdough panini with smoked turkey & swiss cheese',
        longDescription: 'Layers of premium smoked turkey breast, melted Emmental cheese, and honey mustard.',
        price: 95,
        rating: 4.8,
        reviewsCount: 165,
        isBestseller: true,
        isAvailable: true,
        freshnessWindow: 4,
        tags: ['Savory', 'Panini', 'Bestseller'],
        image: { public_id: 'resto_seed/products/turkey_panini', secure_url: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=800&q=80' },
        category: catMap.get('Sandwiches'),
        restaurantId: restaurant._id,
        isDeleted: false,
      },
      {
        title: 'Falafel Baladi Pocket',
        slug: slugify('Falafel Baladi Pocket', { lower: true, strict: true }),
        description: 'Crispy fava bean falafel in warm baladi bread with tahini',
        longDescription: 'Crispy fried herbs & fava bean falafel stuffed in warm baladi bread.',
        price: 30,
        rating: 4.9,
        reviewsCount: 420,
        isBestseller: true,
        isAvailable: true,
        freshnessWindow: 2,
        tags: ['Egyptian', 'Vegan', 'Bestseller'],
        image: { public_id: 'resto_seed/products/falafel_pocket', secure_url: 'https://images.unsplash.com/photo-1593001874117-c99c800e3eb7?auto=format&fit=crop&w=800&q=80' },
        category: catMap.get('Sandwiches'),
        restaurantId: restaurant._id,
        isDeleted: false,
      },
    ];

    const templateCatalog = [
      { title: 'Pain au Chocolat Deluxe', cat: 'Pastry', price: 55, img: 'https://images.unsplash.com/photo-1608198093002-ad4e005484ec?auto=format&fit=crop&w=800&q=80' },
      { title: 'Classic Tiramisu Slice', cat: 'Desserts', price: 90, img: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=800&q=80' },
      { title: 'Avocado Toast Supreme', cat: 'Sandwiches', price: 75, img: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=800&q=80' },
      { title: 'Chocolate Chip Muffin', cat: 'Muffins', price: 40, img: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=800&q=80' },
      { title: 'Blueberry Cheesecake', cat: 'Cakes', price: 120, img: 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?auto=format&fit=crop&w=800&q=80' },
      { title: 'Sesame Bagel', cat: 'Bagels', price: 35, img: 'https://images.unsplash.com/photo-1559563458-527698bf5295?auto=format&fit=crop&w=800&q=80' },
      { title: 'Glazed Ring Donut', cat: 'Donuts', price: 30, img: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=800&q=80' },
      { title: 'Lemon Tart', cat: 'Tarts', price: 65, img: 'https://images.unsplash.com/photo-1587248720654-f1b5f15b3df7?auto=format&fit=crop&w=800&q=80' },
      { title: 'Maple Syrup Pancake Stack', cat: 'Pancakes', price: 80, img: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?auto=format&fit=crop&w=800&q=80' },
      { title: 'Belgian Chocolate Waffle', cat: 'Waffles', price: 85, img: 'https://images.unsplash.com/photo-1562376552-0d160a2f238d?auto=format&fit=crop&w=800&q=80' },
      { title: 'Mango Passion Smoothie', cat: 'Smoothies', price: 60, img: 'https://images.unsplash.com/photo-1556881286-fc6915169721?auto=format&fit=crop&w=800&q=80' },
      { title: 'Caesar Salad Bowl', cat: 'Salads', price: 70, img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80' },
      { title: 'Lentil Soup Pot', cat: 'Soups', price: 45, img: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=800&q=80' },
      { title: 'Margherita Pizza', cat: 'Pizzas', price: 110, img: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=800&q=80' },
      { title: 'Penne Carbonara', cat: 'Pasta', price: 100, img: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?auto=format&fit=crop&w=800&q=80' },
      { title: 'Egyptian Biryani Rice', cat: 'Rice Dishes', price: 90, img: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80' },
    ];

    // Seed 3-4 products for EVERY restaurant (including extra restaurants)
    for (let rIdx = 0; rIdx < allRestaurants.length; rIdx++) {
      const rest = allRestaurants[rIdx];
      const itemsToPick = [
        templateCatalog[(rIdx * 2) % templateCatalog.length],
        templateCatalog[(rIdx * 2 + 1) % templateCatalog.length],
        templateCatalog[(rIdx * 2 + 2) % templateCatalog.length],
      ];

      itemsToPick.forEach((item, itemIdx) => {
        const title = rIdx === 0 && itemIdx === 0 ? item.title : `${rest.name} ${item.title}`;
        productsData.push({
          title,
          slug: slugify(`${title}-${rIdx}-${itemIdx}`, { lower: true, strict: true }),
          description: `Freshly prepared ${item.title.toLowerCase()} from ${rest.name}.`,
          longDescription: `Signature ${item.title} prepared daily with high quality ingredients at ${rest.name}.`,
          price: item.price,
          rating: 4.5 + ((rIdx + itemIdx) % 5) * 0.1,
          reviewsCount: 30 + (rIdx + itemIdx) * 7,
          isBestseller: itemIdx % 2 === 0,
          isAvailable: true,
          freshnessWindow: 12,
          tags: ['Fresh', 'House Special'],
          image: {
            public_id: `resto_seed/products/${slugify(title, { lower: true, strict: true })}`,
            secure_url: item.img,
          },
          category: catMap.get(item.cat) || catMap.get('Desserts')!,
          restaurantId: rest._id,
          isDeleted: false,
        });
      });
    }

    const allProducts = await ProductModel.insertMany(productsData);
    console.log(`✅ Products seeded: ${allProducts.length}`);

    // ─── 7. Seed Ingredients (Total Ingredients >= 25) ───────────────────────────
    console.log('🥕 Seeding ingredients...');
    const ingredientDefs = [
      { name: 'All-Purpose Flour', code: 'ING-FLR-001', unit: 'kg', shelfLifeDays: 180, minStock: 50, safetyStock: 20 },
      { name: 'Unsalted Butter', code: 'ING-BTR-001', unit: 'kg', shelfLifeDays: 30, minStock: 20, safetyStock: 10 },
      { name: 'Fresh Eggs', code: 'ING-EGG-001', unit: 'piece', shelfLifeDays: 14, minStock: 100, safetyStock: 40 },
      { name: 'Whole Milk', code: 'ING-MLK-001', unit: 'liter', shelfLifeDays: 7, minStock: 30, safetyStock: 15 },
      { name: 'Granulated Sugar', code: 'ING-SUG-001', unit: 'kg', shelfLifeDays: 365, minStock: 40, safetyStock: 15 },
      { name: 'Active Dry Yeast', code: 'ING-YST-001', unit: 'kg', shelfLifeDays: 365, minStock: 5, safetyStock: 2 },
      { name: 'Fine Sea Salt', code: 'ING-SLT-001', unit: 'kg', shelfLifeDays: 730, minStock: 10, safetyStock: 5 },
      { name: 'Dark Chocolate 70%', code: 'ING-CHO-001', unit: 'kg', shelfLifeDays: 180, minStock: 15, safetyStock: 5 },
      { name: 'Extra Virgin Olive Oil', code: 'ING-OIL-001', unit: 'liter', shelfLifeDays: 365, minStock: 20, safetyStock: 8 },
      { name: 'Fresh Cream (Eshta)', code: 'ING-CRM-001', unit: 'liter', shelfLifeDays: 5, minStock: 10, safetyStock: 5 },
      { name: 'Pistachios (Shelled)', code: 'ING-PST-001', unit: 'kg', shelfLifeDays: 120, minStock: 5, safetyStock: 2 },
      { name: 'Rosewater', code: 'ING-ROS-001', unit: 'liter', shelfLifeDays: 365, minStock: 5, safetyStock: 2 },
      { name: 'Semolina', code: 'ING-SEM-001', unit: 'kg', shelfLifeDays: 180, minStock: 30, safetyStock: 10 },
      { name: 'Fava Beans (Dried)', code: 'ING-FVB-001', unit: 'kg', shelfLifeDays: 365, minStock: 25, safetyStock: 10 },
      { name: 'Fresh Tomatoes', code: 'ING-TMT-001', unit: 'kg', shelfLifeDays: 7, minStock: 20, safetyStock: 8 },
      { name: 'Arabica Coffee Beans', code: 'ING-COF-001', unit: 'kg', shelfLifeDays: 90, minStock: 5, safetyStock: 2 },
      { name: 'Condensed Milk', code: 'ING-CNM-001', unit: 'liter', shelfLifeDays: 365, minStock: 10, safetyStock: 4 },
      { name: 'Mascarpone Cheese', code: 'ING-MAS-001', unit: 'kg', shelfLifeDays: 14, minStock: 10, safetyStock: 4 },
      { name: 'Ladyfinger Biscuits', code: 'ING-LAD-001', unit: 'kg', shelfLifeDays: 60, minStock: 8, safetyStock: 3 },
      { name: 'Avocados', code: 'ING-AVO-001', unit: 'piece', shelfLifeDays: 5, minStock: 30, safetyStock: 10 },
      { name: 'Mozzarella Cheese', code: 'ING-MOZ-001', unit: 'kg', shelfLifeDays: 20, minStock: 15, safetyStock: 5 },
      { name: 'Blueberries (Fresh)', code: 'ING-BLU-001', unit: 'kg', shelfLifeDays: 7, minStock: 10, safetyStock: 3 },
      { name: 'Pure Maple Syrup', code: 'ING-MAP-001', unit: 'liter', shelfLifeDays: 180, minStock: 8, safetyStock: 2 },
      { name: 'Romaine Lettuce', code: 'ING-LET-001', unit: 'kg', shelfLifeDays: 5, minStock: 15, safetyStock: 5 },
      { name: 'Red Lentils', code: 'ING-LNT-001', unit: 'kg', shelfLifeDays: 365, minStock: 25, safetyStock: 10 },
    ];
    const insertedIngredients = await IngredientModel.insertMany(
      ingredientDefs.map((ing) => ({
        restaurantId: managerRestaurantId,
        ingredientCode: ing.code,
        name: ing.name,
        unit: ing.unit,
        shelfLifeDays: ing.shelfLifeDays,
        minimumStock: ing.minStock,
        safetyStock: ing.safetyStock,
        isDeleted: false,
      })),
    );
    console.log(`✅ Ingredients seeded: ${insertedIngredients.length}`);

    // ─── 8. Seed Recipes (Total Recipes >= 25) ────────────────────────────────────
    console.log('📖 Seeding recipes...');
    const recipesData = allProducts.map((prod, i) => ({
      restaurantId: prod.restaurantId,
      productId: prod._id,
      ingredients: [
        {
          ingredientId: insertedIngredients[i % insertedIngredients.length]._id,
          quantityPerPortion: 0.5,
          unit: insertedIngredients[i % insertedIngredients.length].unit,
          yieldPercentage: 95,
        },
        {
          ingredientId: insertedIngredients[(i + 1) % insertedIngredients.length]._id,
          quantityPerPortion: 0.2,
          unit: insertedIngredients[(i + 1) % insertedIngredients.length].unit,
          yieldPercentage: 90,
        },
      ],
      isDeleted: false,
    }));
    const insertedRecipes = await RecipeModel.insertMany(recipesData);
    console.log(`✅ Recipes seeded: ${insertedRecipes.length}`);

    // ─── 9. Seed Suppliers (Total Suppliers >= 20) ────────────────────────────────
    console.log('🏢 Seeding suppliers...');
    const supplierNames = [
      'Egyptian Grain Co', 'Nile Dairy & Farms', 'Delta Produce Suppliers', 'Red Sea Packaging', 'Cairo Spice Imports',
      'Alexandria Poultry', 'Giza Flour Mills', 'Suez Coffee Beans', 'Sinai Oils & Fats', 'Upper Egypt Produce',
      'Luxor Dairy Works', 'Aswan Organic Farms', 'Matrouh Salt Co', 'Fayoum Honey Farms', 'Minya Agro Tech',
      'Asyut Greenhouses', 'Sohag Spice Traders', 'Qena Fruit Traders', 'Beni Suef Grain', 'Tanta Packaging'
    ];
    const insertedSuppliers = await SupplierModel.insertMany(
      supplierNames.map((name) => ({
        restaurantId: managerRestaurantId,
        name,
        email: `contact@${slugify(name, { lower: true })}.eg`,
        phone: `+20110${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`,
        leadTimeDays: 1 + (Math.floor(Math.random() * 4)),
        isDeleted: false,
      })),
    );
    console.log(`✅ Suppliers seeded: ${insertedSuppliers.length}`);

    // ─── 10. Seed Inventory Batches (Total Batches >= 25) ─────────────────────────
    console.log('📦 Seeding inventory batches...');
    const batchData = insertedIngredients.map((ing, i) => ({
      restaurantId: ing.restaurantId,
      ingredientId: ing._id,
      batchNumber: `BATCH-2026-${String(i + 1).padStart(3, '0')}`,
      quantityRemaining: 50 + i * 10,
      unitCost: 15 + i * 2,
      receivedDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      expiryDate: new Date(Date.now() + (ing.shelfLifeDays || 30) * 24 * 60 * 60 * 1000),
      isDeleted: false,
    }));
    const insertedBatches = await InventoryBatchModel.insertMany(batchData);
    console.log(`✅ Inventory Batches seeded: ${insertedBatches.length}`);

    // ─── 11. Seed Stock Transactions (Total Transactions >= 25) ───────────────────
    console.log('📊 Seeding stock transactions...');
    const txTypes = ['purchase', 'consumption', 'waste', 'adjustment', 'transfer_in', 'transfer_out', 'return_to_supplier'];
    const stockTxData = insertedIngredients.map((ing, i) => ({
      restaurantId: ing.restaurantId,
      ingredientId: ing._id,
      batchId: insertedBatches[i]._id,
      transactionType: txTypes[i % txTypes.length],
      quantity: 10 + i * 2,
      unit: ing.unit,
      date: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
      isDeleted: false,
    }));
    const insertedStockTx = await StockTransactionModel.insertMany(stockTxData);
    console.log(`✅ Stock Transactions seeded: ${insertedStockTx.length}`);

    // ─── 12. Seed Waste Events (Total Waste Events >= 20) ─────────────────────────
    console.log('🗑️ Seeding waste events...');
    const wasteReasons = ['expired', 'overproduction', 'preparation_loss', 'spoiled', 'customer_return', 'damaged', 'incorrect_order', 'unknown'];
    const wasteData: any[] = [];
    for (let i = 0; i < 20; i++) {
      const ing = insertedIngredients[i % insertedIngredients.length];
      wasteData.push({
        restaurantId: ing.restaurantId,
        ingredientId: ing._id,
        batchId: insertedBatches[i % insertedBatches.length]._id,
        quantity: 2 + (i % 5),
        unit: ing.unit,
        wasteReason: wasteReasons[i % wasteReasons.length],
        estimatedCost: Math.round((2 + (i % 5)) * (15 + i * 2)),
        date: new Date(Date.now() - i * 12 * 60 * 60 * 1000),
        isDeleted: false,
      });
    }
    const insertedWasteEvents = await WasteEventModel.insertMany(wasteData);
    console.log(`✅ Waste Events seeded: ${insertedWasteEvents.length}`);

    // ─── 13. Seed Purchase Orders (Total Purchase Orders >= 20) ────────────────────
    console.log('📝 Seeding purchase orders...');
    const poStatuses = ['draft', 'sent', 'received', 'cancelled'];
    const poData: any[] = [];
    for (let i = 0; i < 20; i++) {
      const sup = insertedSuppliers[i % insertedSuppliers.length];
      const ing = insertedIngredients[i % insertedIngredients.length];
      poData.push({
        restaurantId: sup.restaurantId,
        supplierId: sup._id,
        items: [
          {
            ingredientId: ing._id,
            quantity: 50 + i * 10,
            unit: ing.unit,
            unitCost: 20 + i,
          },
        ],
        status: poStatuses[i % poStatuses.length],
        source: i % 2 === 0 ? 'ai_forecast' : 'manual',
        expectedDeliveryDate: new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000),
        createdBy: managerUser._id,
        isDeleted: false,
      });
    }
    const insertedPurchaseOrders = await PurchaseOrderModel.insertMany(poData);
    console.log(`✅ Purchase Orders seeded: ${insertedPurchaseOrders.length}`);

    // ─── 14. Seed Offers Across ALL Restaurants ─────────────────────────────────────
    console.log('🏷️ Seeding offers across all restaurants...');
    const offersData: any[] = [];
    let globalOfferIndex = 0;

    for (let rIdx = 0; rIdx < allRestaurants.length; rIdx++) {
      const rest = allRestaurants[rIdx];
      const rProducts = allProducts.filter((p) => p.restaurantId.equals(rest._id));

      rProducts.forEach((prod, pIdx) => {
        globalOfferIndex++;
        const isActive = (rIdx + pIdx) % 4 !== 0;
        const useFixedPrice = pIdx % 3 === 0;

        const originalPrice = prod.price;
        let offerPrice: number;
        let discountPercentage: number;
        let discountType: string;

        if (useFixedPrice) {
          discountType = 'fixed';
          offerPrice = Math.max(5, Math.round(originalPrice * 0.7));
          discountPercentage = Math.round((1 - offerPrice / originalPrice) * 100);
        } else {
          discountType = 'percentage';
          discountPercentage = 15 + ((rIdx + pIdx) % 35);
          offerPrice = Math.max(5, Math.round(originalPrice * (1 - discountPercentage / 100)));
        }

        offersData.push({
          productId: prod._id,
          restaurantId: rest._id, // Strictly connected to the product's restaurant!
          originalPrice,
          offerPrice,
          discountPercentage,
          discountType,
          availableQuantity: 30,
          remainingQuantity: isActive ? 15 : 0,
          maxPerCustomer: 5,
          startDate: isActive ? new Date() : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          endDate: isActive ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          status: isActive ? 'active' : 'expired',
          source: globalOfferIndex % 2 === 0 ? 'manual' : 'ai_recommendation',
          featured: globalOfferIndex % 3 === 0,
          estimatedWasteReduction: 12,
          estimatedRevenueRecovery: 250,
          createdBy: rest.ownerUserId || managerUser._id,
          isDeleted: false,
        });
      });
    }

    const insertedOffers = await OfferModel.insertMany(offersData);
    const offerIds = insertedOffers.map((o) => o._id);
    console.log(`✅ Offers seeded across all restaurants: ${insertedOffers.length}`);

    // ─── 15. Seed Favorites (Total Favorites >= 25) ───────────────────────────────
    console.log('❤️ Seeding favorites...');
    const favSet = new Set<string>();
    const favoritesData: any[] = [];
    for (let i = 0; i < 40 && favoritesData.length < 25; i++) {
      const uid = allUserIds[i % allUserIds.length];
      const oid = offerIds[i % offerIds.length];
      const key = `${uid.toString()}_${oid.toString()}`;
      if (!favSet.has(key)) {
        favSet.add(key);
        favoritesData.push({ userId: uid, offerId: oid });
      }
    }
    const insertedFavorites = await FavoriteModel.insertMany(favoritesData);
    console.log(`✅ Favorites seeded: ${insertedFavorites.length}`);

    // ─── 16. Seed Carts (Total Carts >= 20) ───────────────────────────────────────
    console.log('🛒 Seeding carts...');
    const cartsData = allUserIds.slice(0, 20).map((uid, i) => ({
      userId: uid,
      items: [{ offerId: offerIds[i % offerIds.length], quantity: 1 + (i % 3) }],
    }));
    const insertedCarts = await CartModel.insertMany(cartsData);
    console.log(`✅ Carts seeded: ${insertedCarts.length}`);

    // ─── 17. Seed Orders & OrderGroups (Total Orders >= 25, OrderGroups >= 20) ───
    console.log('📋 Seeding orders & order groups...');
    const orderStatuses = ['Pending', 'Confirmed', 'Preparing', 'Ready', 'Out For Delivery', 'Delivered', 'Cancelled'];
    const allOrderIds: Types.ObjectId[] = [];

    for (let i = 0; i < 25; i++) {
      const off = insertedOffers[i % insertedOffers.length];
      const prod = allProducts.find((p) => p._id.equals(off.productId)) || allProducts[0];
      const rest = allRestaurants.find((r) => r._id.equals(off.restaurantId)) || allRestaurants[0];
      const qty = 1 + (i % 3);
      const lineTotal = off.offerPrice * qty;
      const isDelivery = i % 2 === 0;

      const order = await OrderModel.create({
        userId: customerUser._id,
        restaurantId: off.restaurantId, // Correctly linked to the offer's restaurant
        items: [
          {
            offerId: off._id,
            productId: prod._id,
            productTitle: prod.title,
            productImage: prod.image?.secure_url || '',
            restaurantId: off.restaurantId, // Correctly linked to the offer's restaurant
            restaurantName: rest.name, // Correctly linked to the offer's restaurant name
            originalPrice: off.originalPrice,
            offerPrice: off.offerPrice,
            discountPercentage: off.discountPercentage,
            quantity: qty,
            purchasedAt: new Date(Date.now() - (25 - i) * 6 * 60 * 60 * 1000),
            lineTotal,
          },
        ],
        totalOriginalPrice: off.originalPrice * qty,
        totalDiscount: (off.originalPrice - off.offerPrice) * qty,
        finalTotalPrice: lineTotal,
        totalQuantity: qty,
        fullName: 'Sara Ahmed',
        phoneNumber: '+201000000002',
        emailAddress: 'sara@example.com',
        deliveryMethod: isDelivery ? 'Home Delivery' : 'Store Pickup',
        ...(isDelivery ? { deliveryAddress: { street: '12 Nile St', city: 'Cairo', country: 'Egypt' } } : {}),
        paymentMethod: 'Cash on Delivery',
        status: orderStatuses[i % orderStatuses.length],
      });
      allOrderIds.push(order._id);
    }
    console.log(`✅ Orders seeded: ${allOrderIds.length}`);

    const orderGroupsData: any[] = [];
    for (let i = 0; i < 20; i++) {
      const ogOrders = [allOrderIds[i % allOrderIds.length]];
      orderGroupsData.push({
        userId: customerUser._id,
        orderIds: ogOrders,
        fullName: 'Sara Ahmed',
        phoneNumber: '+201000000002',
        emailAddress: 'sara@example.com',
        deliveryMethod: 'Home Delivery',
        deliveryAddress: { street: '12 Nile St', city: 'Cairo', country: 'Egypt' },
        paymentMethod: 'Cash on Delivery',
        totalOriginalPrice: 200 + i * 10,
        totalDiscount: 20,
        finalTotalPrice: 180 + i * 10,
        totalQuantity: 2,
        overallStatus: 'Pending',
      });
    }
    const insertedOrderGroups = await OrderGroupModel.insertMany(orderGroupsData);
    console.log(`✅ Order Groups seeded: ${insertedOrderGroups.length}`);

    // ─── 18. Seed Sales Transactions (Total Sales Transactions >= 25) ──────────────
    console.log('💰 Seeding sales transactions...');
    const salesSources = ['csv_import', 'marketplace_order', 'pos_sync'];
    const salesData: any[] = [];
    for (let i = 0; i < 25; i++) {
      const prod = allProducts[i % allProducts.length];
      salesData.push({
        restaurantId: prod.restaurantId,
        productId: prod._id,
        date: new Date(Date.now() - (25 - i) * 24 * 60 * 60 * 1000),
        quantitySold: 5 + (i % 10),
        basePrice: prod.price,
        sellingPrice: Math.round(prod.price * 0.9),
        promotionActive: i % 2 === 0,
        featured: i % 4 === 0,
        stockoutMinutes: i % 6 === 0 ? 15 : 0,
        salesChannel: 'marketplace',
        source: salesSources[i % salesSources.length],
        orderId: allOrderIds[i % allOrderIds.length],
        isDeleted: false,
      });
    }
    const insertedSalesTx = await SalesTransactionModel.insertMany(salesData);
    console.log(`✅ Sales Transactions seeded: ${insertedSalesTx.length}`);

    // ─── 19. Seed Weekly Predictions (Total Predictions >= 20) ─────────────────────
    console.log('🔮 Seeding weekly predictions...');
    const predictionsData: any[] = [];
    for (let i = 0; i < 20; i++) {
      const prod = allProducts[i % allProducts.length];
      predictionsData.push({
        restaurantId: prod.restaurantId,
        productId: prod._id,
        modelVersionId: 'v1.2.0',
        targetWeek: `2026-08-${String((i % 4) * 7 + 3).padStart(2, '0')}`,
        predictedOrders: 100 + i * 12,
        confidence: i % 3 === 0 ? 'high' : i % 2 === 0 ? 'medium' : 'low',
        source: i % 2 === 0 ? 'ai_model' : 'fallback_naive',
        featuresUsed: { seasonality: true, lag_7: 100 + i * 10 },
        dailyBreakdown: [
          { date: '2026-08-03', predictedQuantity: 15 + i },
          { date: '2026-08-04', predictedQuantity: 18 + i },
          { date: '2026-08-05', predictedQuantity: 20 + i },
          { date: '2026-08-06', predictedQuantity: 22 + i },
          { date: '2026-08-07', predictedQuantity: 25 + i },
        ],
        actualOrders: 95 + i * 10,
        errorAbs: 5 + (i % 3),
        isDeleted: false,
      });
    }
    const insertedPredictions = await PredictionModel.insertMany(predictionsData);
    console.log(`✅ Weekly Predictions seeded: ${insertedPredictions.length}`);

    // ─── 20. Seed Daily Production Plans (Total Production Plans >= 20) ────────────
    console.log('📅 Seeding daily production plans...');
    const productionPlanData: any[] = [];
    for (let i = 0; i < 20; i++) {
      const dateStr = new Date(Date.now() - (20 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const rest = allRestaurants[i % allRestaurants.length];
      const restProds = allProducts.filter((p) => p.restaurantId.equals(rest._id));
      const prodsForPlan = restProds.slice(0, 3);
      if (prodsForPlan.length > 0) {
        productionPlanData.push({
          restaurantId: rest._id,
          date: dateStr,
          totalRecommendedQty: 60 + i * 5,
          items: prodsForPlan.map((p) => ({
            productId: p._id,
            recommendedQty: 20 + (i % 5) * 5,
            lowerBound: 15,
            upperBound: 30,
            confidence: i % 2 === 0 ? 'high' : 'medium',
            source: i % 2 === 0 ? 'ai_model' : 'fallback_yesterday',
            actualProducedQty: 22 + (i % 5) * 5,
          })),
          isDeleted: false,
        });
      }
    }
    const insertedProductionPlans = await DailyProductionPlanModel.insertMany(productionPlanData);
    console.log(`✅ Daily Production Plans seeded: ${insertedProductionPlans.length}`);

    // ─── 21. Seed Import Jobs (Total Import Jobs >= 20) ───────────────────────────
    console.log('📁 Seeding import jobs...');
    const importTypes = ['sales_history', 'inventory_transactions', 'recipes', 'menu_items', 'ingredients'];
    const importStatuses = ['processing', 'validated', 'ai_ingest_pending', 'completed', 'failed'];
    const importJobsData: any[] = [];
    for (let i = 0; i < 20; i++) {
      importJobsData.push({
        restaurantId: managerRestaurantId,
        uploadedBy: managerUser._id,
        importType: importTypes[i % importTypes.length],
        fileName: `import_batch_${i + 1}.csv`,
        columnMapping: { date: 'Date', quantitySold: 'Qty', sellingPrice: 'Price' },
        status: importStatuses[i % importStatuses.length],
        totalRows: 100 + i * 10,
        validRows: 95 + i * 10,
        invalidRows: 5,
        aiIngestAttempts: 1,
        isDeleted: false,
      });
    }
    const insertedImportJobs = await ImportJobModel.insertMany(importJobsData);
    console.log(`✅ Import Jobs seeded: ${insertedImportJobs.length}`);

    // ─── 22. Seed Waste Reports (Total Waste Reports >= 20) ───────────────────────
    console.log('📊 Seeding waste reports...');
    const riskLevels = ['low', 'medium', 'high'];
    const wasteReportData: any[] = [];
    for (let i = 0; i < 20; i++) {
      const ing = insertedIngredients[i % insertedIngredients.length];
      const pred = insertedPredictions[i % insertedPredictions.length];
      wasteReportData.push({
        restaurantId: pred.restaurantId,
        predictionId: pred._id,
        ingredientId: ing._id,
        expectedConsumption: 30 + i * 2,
        usableAvailableStock: 50 + i * 3,
        expectedSurplus: 20 + i,
        riskLevel: riskLevels[i % riskLevels.length],
        isDeleted: false,
      });
    }
    const insertedWasteReports = await WasteReportModel.insertMany(wasteReportData);
    console.log(`✅ Waste Reports seeded: ${insertedWasteReports.length}`);

    // ─── 23. Seed Recommendations (Total Recommendations >= 20) ───────────────────
    console.log('💡 Seeding recommendations...');
    const recTypes = ['apply_discount', 'reduce_purchase', 'stop_production', 'transfer_stock'];
    const recStatuses = ['pending', 'approved', 'edited', 'dismissed'];
    const recData: any[] = [];
    for (let i = 0; i < 20; i++) {
      const wr = insertedWasteReports[i % insertedWasteReports.length];
      const prod = allProducts[i % allProducts.length];
      recData.push({
        restaurantId: prod.restaurantId,
        wasteReportId: wr._id,
        productId: prod._id,
        type: recTypes[i % recTypes.length],
        suggestedValue: 20 + i * 2,
        targetRestaurantId: allRestaurantIds[(i + 1) % allRestaurantIds.length],
        gptExplanation: `Recommended ${recTypes[i % recTypes.length]} to reduce surplus inventory for ${prod.title}.`,
        status: recStatuses[i % recStatuses.length],
        reviewedBy: i % 2 === 0 ? managerUser._id : null,
        isDeleted: false,
      });
    }
    const insertedRecommendations = await RecommendationModel.insertMany(recData);
    console.log(`✅ Recommendations seeded: ${insertedRecommendations.length}`);

    // ─── 24. Seed OTPs (Total OTPs >= 20) ──────────────────────────────────────────
    console.log('🔑 Seeding OTPs...');
    const otpsData: any[] = [];
    for (let i = 0; i < 20; i++) {
      otpsData.push({
        otp: String(100000 + i * 1111).slice(0, 6),
        userId: allUserIds[i % allUserIds.length],
        type: i % 2 === 0 ? 'confirmation' : 'reset-password',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        isUsed: i % 3 === 0,
      });
    }
    const insertedOtps = await OtpModel.insertMany(otpsData);
    console.log(`✅ OTPs seeded: ${insertedOtps.length}`);

    // ─── 25. Seed Partnership Applications (Total Applications >= 20) ──────────────
    console.log('🤝 Seeding partnership applications...');
    const businessTypes = ['bakery', 'restaurant', 'cafe', 'patisserie', 'supermarket', 'hotel', 'catering', 'other'];
    const appStatuses = ['pending', 'under_review', 'approved', 'rejected'];
    const partnershipAppsData: any[] = [];
    const applicantNames = [
      { first: 'Youssef', last: 'Nabil', bName: 'Nabil Artisan Bakery' },
      { first: 'Khaled', last: 'Sami', bName: 'Cairo Sweets & Cafe' },
      { first: 'Dina', last: 'Hassan', bName: 'Golden Croissant Lab' },
      { first: 'Amr', last: 'Fouad', bName: 'Nile Breeze Bistro' },
      { first: 'Nour', last: 'Sherif', bName: 'Alexandria Fresh Pies' },
      { first: 'Tarek', last: 'Mostafa', bName: 'Giza Gourmet Pastries' },
      { first: 'Rania', last: 'Adel', bName: 'Pyramid Donut Works' },
      { first: 'Hisham', last: 'Zaki', bName: 'Zamalek Coffee & Kitchen' },
      { first: 'Salma', last: 'Ibrahim', bName: 'Maadi Artisan Bakes' },
      { first: 'Karim', last: 'Reda', bName: 'Heliopolis Pancake House' },
      { first: 'Ayman', last: 'Farid', bName: 'Downtown Bagel Spot' },
      { first: 'Mona', last: 'Magdy', bName: 'Shorouk Cake Studio' },
      { first: 'Sherif', last: 'Habib', bName: 'Sheikh Zayed Cafe' },
      { first: 'Fatma', last: 'Salem', bName: '6th October Delights' },
      { first: 'Walid', last: 'Taha', bName: 'Tagamoa Organic Bakery' },
      { first: 'Soha', last: 'Ashraf', bName: 'Red Sea Treats' },
      { first: 'Hazem', last: 'Osman', bName: 'Luxor Traditional Bakes' },
      { first: 'Inas', last: 'Amer', bName: 'Aswan Sun Cafe' },
      { first: 'Eslam', last: 'Sabry', bName: 'Suez Bakery & Grill' },
      { first: 'Mai', last: 'Khedr', bName: 'Fayoum Honey Bakes' },
    ];

    for (let i = 0; i < applicantNames.length; i++) {
      const app = applicantNames[i];
      const status = appStatuses[i % appStatuses.length];
      const isApproved = status === 'approved';
      const isRejected = status === 'rejected';

      partnershipAppsData.push({
        businessName: app.bName,
        businessType: businessTypes[i % businessTypes.length],
        description: `High-capacity ${businessTypes[i % businessTypes.length]} looking to join RestoMind surplus recovery platform.`,
        estimatedOrdersPerDay: 50 + i * 15,
        estimatedWasteKgPerDay: 5 + i * 2,
        ownerFirstName: app.first,
        ownerLastName: app.last,
        email: `${app.first.toLowerCase()}.${app.last.toLowerCase()}@partnerdomain.com`,
        phone: `+20109${String(90000000 + i).slice(0, 8)}`,
        city: 'Cairo',
        district: 'New Cairo',
        street: `${i + 10} Commercial Axis`,
        website: `https://www.${slugify(app.bName, { lower: true, strict: true })}.com`,
        facebookPage: `https://facebook.com/${slugify(app.bName, { lower: true, strict: true })}`,
        instagramPage: `https://instagram.com/${slugify(app.bName, { lower: true, strict: true })}`,
        commercialRegistration: `CR-2026-${1000 + i}`,
        taxId: `TAX-EG-${5000 + i}`,
        notes: 'Interested in AI-driven waste recovery and surplus offer automation.',
        status,
        ...(isRejected ? { rejectionReason: 'Incomplete commercial license details.' } : {}),
        ...(isApproved
          ? {
              reviewedBy: adminUser._id,
              approvedBy: adminUser._id,
              approvedAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
              userId: allUserIds[i % allUserIds.length],
              restaurantId: allRestaurantIds[i % allRestaurantIds.length],
            }
          : {}),
        isDeleted: false,
      });
    }
    const insertedPartnershipApps = await PartnershipApplicationModel.insertMany(partnershipAppsData);
    console.log(`✅ Partnership Applications seeded: ${insertedPartnershipApps.length}`);

    console.log('🎉 Database seeding complete!');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

seed();
