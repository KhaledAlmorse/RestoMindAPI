import 'reflect-metadata';
import mongoose, { Types } from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import slugify from 'slugify';
import * as bcrypt from 'bcrypt';
import { SchemaFactory } from '@nestjs/mongoose';

import {
  User,
  Otp,
  RevokedToken,
  Category,
  Product,
  Favorite,
  Cart,
  Order,
  OrderGroup,
  Restaurant,
  Offer,
  Ingredient,
  Recipe,
  SalesTransaction,
  InventoryBatch,
  StockTransaction,
  WasteEvent,
  Supplier,
  PurchaseOrder,
  ImportJob,
  DailyProductionPlan,
  Prediction,
  WasteReport,
  Recommendation,
  PartnershipApplication,
  Payment,
  Refund,
  Payout,
  MerchantAdjustment,
  SystemSettings,
  SubscriptionPlan,
  Notification,
  WeeklyExecutiveSnapshot,
  AssistantActionLog,
  RecommendationAction,
  AssistantChatHistory,
} from './Models';
import { NotificationType } from '../notification/enums/notification-type.enum';
import { getBusinessDateString, addDaysToDateString } from '../Common/Utils';

import {
  RolesEnum,
  GenderEnum,
  OtpTypeEnum,
  OfferStatusEnum,
  OfferSourceEnum,
  OfferDiscountTypeEnum,
  IngredientUnitEnum,
  SalesSourceEnum,
  OrderStatusEnum,
  StockTransactionTypeEnum,
  WasteReasonEnum,
  PurchaseOrderStatusEnum,
  PurchaseOrderSourceEnum,
  ImportTypeEnum,
  ImportJobStatusEnum,
  ConfidenceLevelEnum,
  PredictionSourceEnum,
  ProductionPlanSourceEnum,
  RiskLevelEnum,
  RecommendationTypeEnum,
  RecommendationStatusEnum,
  BusinessTypeEnum,
  PartnershipApplicationStatusEnum,
  PaymentPurposeEnum,
  PaymentStatusEnum,
  PaymentMethodEnum,
  RefundStatusEnum,
  RefundSettlementModeEnum,
  PayoutDirectionEnum,
  PayoutStatusEnum,
} from '../Common/Types';

// Load environment variables from .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DB_URL =
  process.env.DB_URL ||
  process.env.DB_URL_alt ||
  'mongodb://localhost:27017/Ecommerce_Api_Nestjs';

function getModel<T>(cls: any): mongoose.Model<T> {
  const schema = SchemaFactory.createForClass(cls);
  return (mongoose.models[cls.name] || mongoose.model(cls.name, schema)) as mongoose.Model<T>;
}

// ─── Register Mongoose Models from App Schema Classes ──────────────────────
const OtpModel = getModel<any>(Otp);
const UserModel = getModel<any>(User);
const RestaurantModel = getModel<any>(Restaurant);
const CategoryModel = getModel<any>(Category);
const ProductModel = getModel<any>(Product);
const CartModel = getModel<any>(Cart);
const OfferModel = getModel<any>(Offer);
const FavoriteModel = getModel<any>(Favorite);
const IngredientModel = getModel<any>(Ingredient);
const RecipeModel = getModel<any>(Recipe);
const SalesTransactionModel = getModel<any>(SalesTransaction);
const OrderModel = getModel<any>(Order);
const OrderGroupModel = getModel<any>(OrderGroup);
const SupplierModel = getModel<any>(Supplier);
const InventoryBatchModel = getModel<any>(InventoryBatch);
const StockTransactionModel = getModel<any>(StockTransaction);
const WasteEventModel = getModel<any>(WasteEvent);
const PurchaseOrderModel = getModel<any>(PurchaseOrder);
const ImportJobModel = getModel<any>(ImportJob);
const PredictionModel = getModel<any>(Prediction);
const DailyProductionPlanModel = getModel<any>(DailyProductionPlan);
const WasteReportModel = getModel<any>(WasteReport);
const RecommendationModel = getModel<any>(Recommendation);
const PartnershipApplicationModel = getModel<any>(PartnershipApplication);
const RevokeTokenModel = getModel<any>(RevokedToken);
const PaymentModel = getModel<any>(Payment);
const RefundModel = getModel<any>(Refund);
const PayoutModel = getModel<any>(Payout);
const MerchantAdjustmentModel = getModel<any>(MerchantAdjustment);
const SystemSettingsModel = getModel<any>(SystemSettings);
const SubscriptionPlanModel = getModel<any>(SubscriptionPlan);
const NotificationModel = getModel<any>(Notification);
const WeeklyExecutiveSnapshotModel = getModel<any>(WeeklyExecutiveSnapshot);
const AssistantActionLogModel = getModel<any>(AssistantActionLog);
const RecommendationActionModel = getModel<any>(RecommendationAction);
const AssistantChatHistoryModel = getModel<any>(AssistantChatHistory);

/**
 * Egyptian mobile numbers are `+20` + a 2-digit carrier prefix (10/11/12/15)
 * + an 8-digit subscriber number — 10 digits after the country code, never
 * 11. A previous version of this file built numbers like `+20101XXXXXXXX`
 * (a 3-digit prefix), which is not a valid Egyptian number length.
 */
const EG_MOBILE_PREFIXES = ['10', '11', '12', '15'];
function egyptPhone(seed: number): string {
  const prefix = EG_MOBILE_PREFIXES[seed % EG_MOBILE_PREFIXES.length];
  const subscriber = String(seed).padStart(8, '0');
  return `+20${prefix}${subscriber}`;
}

/**
 * A correctly-lengthed (29-char) Egyptian IBAN: `EG` + 2 check digits + 4
 * bank code + 21-digit account number. Built entirely from strings — the
 * previous version added an index to a 24-digit numeric literal, which
 * silently overflowed to scientific notation (`EG9e+23`) for every extra
 * restaurant.
 */
function egyptIban(seed: number): string {
  const check = String(seed % 100).padStart(2, '0');
  const account = String(seed).padStart(21, '0');
  return `EG${check}0180${account}`;
}

/**
 * The three launch plans, kept identical to `scripts/seed-subscription-plans.ts`
 * so a freshly seeded database and a migrated production one price plans the
 * same way. `starter` is the trial plan.
 */
const SUBSCRIPTION_PLANS = [
  {
    slug: 'starter',
    label: 'Starter',
    productCap: 50,
    prices: { monthly: 100_000, halfYearly: 540_000, yearly: 960_000 },
    sortOrder: 0,
    archived: false,
    isTrialPlan: true,
  },
  {
    slug: 'plus',
    label: 'Plus',
    productCap: 150,
    prices: { monthly: 175_000, halfYearly: 960_000, yearly: 1_740_000 },
    sortOrder: 1,
    archived: false,
    isTrialPlan: false,
  },
  {
    slug: 'enterprise',
    label: 'Enterprise',
    productCap: null,
    prices: { monthly: 250_000, halfYearly: 1_350_000, yearly: 2_520_000 },
    sortOrder: 2,
    archived: false,
    isTrialPlan: false,
  },
];
const planBySlug = new Map(SUBSCRIPTION_PLANS.map((p) => [p.slug, p]));

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
    await AssistantChatHistoryModel.deleteMany({});
    await RecommendationActionModel.deleteMany({});
    await AssistantActionLogModel.deleteMany({});
    await WeeklyExecutiveSnapshotModel.deleteMany({});
    await NotificationModel.deleteMany({});
    await SubscriptionPlanModel.deleteMany({});
    await SystemSettingsModel.deleteMany({});
    await MerchantAdjustmentModel.deleteMany({});
    await PayoutModel.deleteMany({});
    await RefundModel.deleteMany({});
    await PaymentModel.deleteMany({});
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

    // ─── 0. Seed Platform Settings & Subscription Plans ────────────────────────
    // Must exist before restaurants: their subscription.tier is a plan slug,
    // and effectiveProductCap() reads productCapSnapshot, which comes from here.
    console.log('⚙️ Seeding system settings & subscription plans...');
    await SystemSettingsModel.create({
      key: 'platform',
      freeTrialEnabled: true,
      trialDurationDays: 14,
      earlyBirdEnabled: true,
      earlyBirdCap: 30,
      earlyBirdDiscountPercent: 33.3333,
      defaultCommissionRate: 0.05,
    });
    await SubscriptionPlanModel.insertMany(SUBSCRIPTION_PLANS);
    console.log(`✅ Subscription Plans seeded: ${SUBSCRIPTION_PLANS.length}`);

    // ─── 1. Seed Core Users ─────────────────────────────────────────────────────
    console.log('👤 Seeding core users...');
    const hashedPassword = bcrypt.hashSync('Admin@123', 10);
    const adminUser = await UserModel.create({
      firstName: 'RestoMind',
      lastName: 'Admin',
      email: 'admin@restomind.com',
      password: hashedPassword,
      role: RolesEnum.ADMIN,
      gender: GenderEnum.MALE,
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
      role: RolesEnum.CUSTOMER,
      gender: GenderEnum.FEMALE,
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
      role: RolesEnum.MANAGER,
      gender: GenderEnum.MALE,
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
      role: RolesEnum.STAFF,
      gender: GenderEnum.FEMALE,
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
      subscription: {
        tier: 'plus',
        interval: 'monthly',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        // Without a snapshot effectiveProductCap() reads 0 — see
        // subscription-state.ts — so the seeded restaurant could never
        // create a product through the real API.
        productCapSnapshot: planBySlug.get('plus')!.productCap,
        planLabelSnapshot: planBySlug.get('plus')!.label,
      },
      commissionRate: 0.10,
      payoutDestination: {
        method: 'bank',
        accountName: 'RestoMind Bakery & Cafe Ltd',
        accountNumber: egyptIban(1),
        bankName: 'CIB Egypt',
      },
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
        role: i % 4 === 0 ? RolesEnum.MANAGER : i % 5 === 0 ? RolesEnum.STAFF : RolesEnum.CUSTOMER,
        gender: i % 2 === 0 ? GenderEnum.MALE : GenderEnum.FEMALE,
        phone: egyptPhone(1000 + i),
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
    const extraRests = restNames.map((n, i) => {
      const tierSlug = i % 2 === 0 ? 'enterprise' : 'plus';
      const plan = planBySlug.get(tierSlug)!;
      return {
        name: n,
        ownerUserId: allUserIds[(i + 1) % allUserIds.length],
        description: `Premium ${n.toLowerCase()} serving fresh food daily.`,
        image: {
          public_id: `resto_seed/restaurants/${slugify(n, { lower: true, strict: true })}`,
          secure_url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80',
        },
        phone: egyptPhone(2000 + i),
        address: { street: `${i + 1} Main St`, city: 'Cairo', district: 'Central', country: 'Egypt' },
        subscription: {
          tier: tierSlug,
          interval: 'monthly',
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          productCapSnapshot: plan.productCap,
          planLabelSnapshot: plan.label,
        },
        commissionRate: 0.10,
        payoutDestination: {
          method: 'bank',
          accountName: `${n} Account`,
          accountNumber: egyptIban(100 + i),
          bankName: 'National Bank of Egypt',
        },
        isActive: true,
        isDeleted: false,
      };
    });
    const insertedRests = await RestaurantModel.insertMany(extraRests);
    insertedRests.forEach((r) => allRestaurantIds.push(r._id));
    console.log(`✅ Restaurants seeded: ${allRestaurantIds.length}`);

    // Store restaurant lookup list
    const allRestaurants = [
      {
        _id: restaurant._id,
        name: restaurant.name,
        ownerUserId: adminUser._id,
        // Carried through so seeded orders can snapshot the same rate the
        // application would have applied at checkout.
        commissionRate: restaurant.commissionRate as number | undefined,
      },
      ...insertedRests.map((r) => ({
        _id: r._id,
        name: r.name,
        ownerUserId: r.ownerUserId,
        commissionRate: r.commissionRate as number | undefined,
      })),
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
      { name: 'All-Purpose Flour', code: 'ING-FLR-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 180, minStock: 50, safetyStock: 20 },
      { name: 'Unsalted Butter', code: 'ING-BTR-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 30, minStock: 20, safetyStock: 10 },
      { name: 'Fresh Eggs', code: 'ING-EGG-001', unit: IngredientUnitEnum.PIECE, shelfLifeDays: 14, minStock: 100, safetyStock: 40 },
      { name: 'Whole Milk', code: 'ING-MLK-001', unit: IngredientUnitEnum.LITER, shelfLifeDays: 7, minStock: 30, safetyStock: 15 },
      { name: 'Granulated Sugar', code: 'ING-SUG-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 365, minStock: 40, safetyStock: 15 },
      { name: 'Active Dry Yeast', code: 'ING-YST-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 365, minStock: 5, safetyStock: 2 },
      { name: 'Fine Sea Salt', code: 'ING-SLT-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 730, minStock: 10, safetyStock: 5 },
      { name: 'Dark Chocolate 70%', code: 'ING-CHO-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 180, minStock: 15, safetyStock: 5 },
      { name: 'Extra Virgin Olive Oil', code: 'ING-OIL-001', unit: IngredientUnitEnum.LITER, shelfLifeDays: 365, minStock: 20, safetyStock: 8 },
      { name: 'Fresh Cream (Eshta)', code: 'ING-CRM-001', unit: IngredientUnitEnum.LITER, shelfLifeDays: 5, minStock: 10, safetyStock: 5 },
      { name: 'Pistachios (Shelled)', code: 'ING-PST-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 120, minStock: 5, safetyStock: 2 },
      { name: 'Rosewater', code: 'ING-ROS-001', unit: IngredientUnitEnum.LITER, shelfLifeDays: 365, minStock: 5, safetyStock: 2 },
      { name: 'Semolina', code: 'ING-SEM-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 180, minStock: 30, safetyStock: 10 },
      { name: 'Fava Beans (Dried)', code: 'ING-FVB-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 365, minStock: 25, safetyStock: 10 },
      { name: 'Fresh Tomatoes', code: 'ING-TMT-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 7, minStock: 20, safetyStock: 8 },
      { name: 'Arabica Coffee Beans', code: 'ING-COF-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 90, minStock: 5, safetyStock: 2 },
      { name: 'Condensed Milk', code: 'ING-CNM-001', unit: IngredientUnitEnum.LITER, shelfLifeDays: 365, minStock: 10, safetyStock: 4 },
      { name: 'Mascarpone Cheese', code: 'ING-MAS-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 14, minStock: 10, safetyStock: 4 },
      { name: 'Ladyfinger Biscuits', code: 'ING-LAD-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 60, minStock: 8, safetyStock: 3 },
      { name: 'Avocados', code: 'ING-AVO-001', unit: IngredientUnitEnum.PIECE, shelfLifeDays: 5, minStock: 30, safetyStock: 10 },
      { name: 'Mozzarella Cheese', code: 'ING-MOZ-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 20, minStock: 15, safetyStock: 5 },
      { name: 'Blueberries (Fresh)', code: 'ING-BLU-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 7, minStock: 10, safetyStock: 3 },
      { name: 'Pure Maple Syrup', code: 'ING-MAP-001', unit: IngredientUnitEnum.LITER, shelfLifeDays: 180, minStock: 8, safetyStock: 2 },
      { name: 'Romaine Lettuce', code: 'ING-LET-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 5, minStock: 15, safetyStock: 5 },
      { name: 'Red Lentils', code: 'ING-LNT-001', unit: IngredientUnitEnum.KG, shelfLifeDays: 365, minStock: 25, safetyStock: 10 },
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

    // ─── 8. Seed Recipes (one per manager-restaurant product) ─────────────────────
    // Ingredients only exist for managerRestaurantId (see step 7). A recipe for
    // any other restaurant's product would reference an ingredientId that
    // belongs to a different tenant — orders.service.deductInventoryForDeliveredOrder
    // scopes the ingredient lookup by the ORDER's restaurantId, so that
    // ingredient would resolve to null on every delivery for that restaurant.
    console.log('📖 Seeding recipes...');
    const managerProducts = allProducts.filter((p) => p.restaurantId.equals(managerRestaurantId));
    const recipesData = managerProducts.map((prod, i) => ({
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
      supplierNames.map((name, i) => ({
        restaurantId: managerRestaurantId,
        name,
        email: `contact@${slugify(name, { lower: true })}.eg`,
        phone: egyptPhone(3000 + i),
        leadTimeDays: 1 + (i % 4),
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
    const txTypes = [
      StockTransactionTypeEnum.PURCHASE,
      StockTransactionTypeEnum.CONSUMPTION,
      StockTransactionTypeEnum.WASTE,
      StockTransactionTypeEnum.ADJUSTMENT,
      StockTransactionTypeEnum.TRANSFER_IN,
      StockTransactionTypeEnum.TRANSFER_OUT,
      StockTransactionTypeEnum.RETURN_TO_SUPPLIER,
    ];
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
    const wasteReasons = [
      WasteReasonEnum.EXPIRED,
      WasteReasonEnum.OVERPRODUCTION,
      WasteReasonEnum.PREPARATION_LOSS,
      WasteReasonEnum.SPOILED,
      WasteReasonEnum.CUSTOMER_RETURN,
      WasteReasonEnum.DAMAGED,
      WasteReasonEnum.INCORRECT_ORDER,
      WasteReasonEnum.UNKNOWN,
    ];
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
    const poStatuses = [
      PurchaseOrderStatusEnum.DRAFT,
      PurchaseOrderStatusEnum.SENT,
      PurchaseOrderStatusEnum.RECEIVED,
      PurchaseOrderStatusEnum.CANCELLED,
    ];
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
        source: i % 2 === 0 ? PurchaseOrderSourceEnum.AI_FORECAST : PurchaseOrderSourceEnum.MANUAL,
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
        let discountType: OfferDiscountTypeEnum;

        if (useFixedPrice) {
          discountType = OfferDiscountTypeEnum.FIXED;
          offerPrice = Math.max(5, Math.round(originalPrice * 0.7));
          discountPercentage = Math.round((1 - offerPrice / originalPrice) * 100);
        } else {
          discountType = OfferDiscountTypeEnum.PERCENTAGE;
          discountPercentage = 15 + ((rIdx + pIdx) % 35);
          offerPrice = Math.max(5, Math.round(originalPrice * (1 - discountPercentage / 100)));
        }

        offersData.push({
          productId: prod._id,
          restaurantId: rest._id,
          originalPrice,
          offerPrice,
          discountPercentage,
          discountType,
          availableQuantity: 30,
          remainingQuantity: isActive ? 15 : 0,
          maxPerCustomer: 5,
          startDate: isActive ? new Date() : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          endDate: isActive ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          status: isActive ? OfferStatusEnum.ACTIVE : OfferStatusEnum.EXPIRED,
          source: globalOfferIndex % 2 === 0 ? OfferSourceEnum.MANUAL : OfferSourceEnum.AI_RECOMMENDATION,
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
    const orderStatuses = [
      OrderStatusEnum.PENDING,
      OrderStatusEnum.CONFIRMED,
      OrderStatusEnum.PREPARING,
      OrderStatusEnum.READY,
      OrderStatusEnum.OUT_FOR_DELIVERY,
      OrderStatusEnum.DELIVERED,
      OrderStatusEnum.CANCELLED,
    ];
    const allOrderIds: Types.ObjectId[] = [];
    const ordersData: any[] = [];
    const orderGroupsData: any[] = [];

    /**
     * Orders and groups are built together, one group per order, and the group
     * id is generated up front so it can be written on BOTH sides.
     *
     * The link is not cosmetic. `GET /orders/refunds` scopes a merchant to
     * `orderGroupId ∈ (their orders' groupOrderId)`, so an order without a
     * group means a manager sees an empty refunds page while the rows exist —
     * and payouts read the same link to decide whether a delivered order was
     * ever paid for.
     */
    for (let i = 0; i < 25; i++) {
      const off = insertedOffers[i % insertedOffers.length];
      const prod = allProducts.find((p) => p._id.equals(off.productId)) || allProducts[0];
      const rest = allRestaurants.find((r) => r._id.equals(off.restaurantId)) || allRestaurants[0];
      const qty = 1 + (i % 3);
      const lineTotal = off.offerPrice * qty;
      const isDelivery = i % 2 === 0;
      const status = orderStatuses[i % orderStatuses.length];

      // Two thirds of the marketplace pays online. Cash-on-delivery orders
      // carry no gateway payment, so a seed that is 100% COD leaves every
      // payment and every gateway refund pointing at nothing.
      const paymentMethod =
        i % 3 === 0 ? 'Cash on Delivery' : i % 3 === 1 ? 'Card' : 'Wallet';

      // Delivered well outside PAYOUT_HOLD_DAYS (7), so the merchant statement
      // has payable lines the day the database is seeded rather than a week
      // later.
      const placedAt = new Date(Date.now() - (40 - i) * 24 * 60 * 60 * 1000);
      const deliveredAt =
        status === OrderStatusEnum.DELIVERED
          ? new Date(placedAt.getTime() + 2 * 60 * 60 * 1000)
          : undefined;

      // Snapshot, exactly as orders.service does it: the rate in force now,
      // stored per order so changing a commission never rewrites history.
      const commissionRate = rest.commissionRate ?? 0.05;
      const commissionCents = Math.round(lineTotal * 100 * commissionRate);

      const groupOrderId = new Types.ObjectId();
      const orderId = new Types.ObjectId();
      allOrderIds.push(orderId);

      const addressBlock = { street: '12 Nile St', city: 'Cairo', country: 'Egypt' };

      ordersData.push({
        _id: orderId,
        groupOrderId,
        userId: customerUser._id,
        restaurantId: off.restaurantId,
        items: [
          {
            offerId: off._id,
            productId: prod._id,
            productTitle: prod.title,
            productImage: prod.image?.secure_url || '',
            restaurantId: off.restaurantId,
            restaurantName: rest.name,
            originalPrice: off.originalPrice,
            offerPrice: off.offerPrice,
            discountPercentage: off.discountPercentage,
            quantity: qty,
            purchasedAt: placedAt,
            lineTotal,
          },
        ],
        totalOriginalPrice: off.originalPrice * qty,
        totalDiscount: (off.originalPrice - off.offerPrice) * qty,
        finalTotalPrice: lineTotal,
        commissionRate,
        commissionCents,
        totalQuantity: qty,
        fullName: 'Sara Ahmed',
        phoneNumber: '+201000000002',
        emailAddress: 'sara@example.com',
        deliveryMethod: isDelivery ? 'Home Delivery' : 'Store Pickup',
        ...(isDelivery ? { deliveryAddress: addressBlock } : {}),
        paymentMethod,
        status,
        ...(deliveredAt ? { deliveredAt } : {}),
        createdAt: placedAt,
      });

      // Group totals are the sum of its orders — here, the one order. Made up
      // figures would put the payout ledger and the group at odds.
      orderGroupsData.push({
        _id: groupOrderId,
        userId: customerUser._id,
        orderIds: [orderId],
        fullName: 'Sara Ahmed',
        phoneNumber: '+201000000002',
        emailAddress: 'sara@example.com',
        deliveryMethod: isDelivery ? 'Home Delivery' : 'Store Pickup',
        ...(isDelivery ? { deliveryAddress: addressBlock } : {}),
        paymentMethod,
        totalOriginalPrice: off.originalPrice * qty,
        totalDiscount: (off.originalPrice - off.offerPrice) * qty,
        finalTotalPrice: lineTotal,
        totalQuantity: qty,
        overallStatus: status,
        createdAt: placedAt,
      });
    }

    const insertedOrders = await OrderModel.insertMany(ordersData);
    console.log(`✅ Orders seeded: ${insertedOrders.length}`);
    const insertedOrderGroups = await OrderGroupModel.insertMany(orderGroupsData);
    console.log(`✅ Order Groups seeded: ${insertedOrderGroups.length}`);

    /** Online groups only — a COD group must never get a gateway payment. */
    const payableGroups = orderGroupsData.filter(
      (g) => g.paymentMethod !== 'Cash on Delivery',
    );

    // ─── 18. Seed Sales Transactions (Total Sales Transactions >= 25) ──────────────
    console.log('💰 Seeding sales transactions...');
    const salesSources = [SalesSourceEnum.CSV_IMPORT, SalesSourceEnum.MARKETPLACE_ORDER, SalesSourceEnum.POS_SYNC];
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
    // Dates are derived from the Cairo business date, never `toISOString()` —
    // see restomind-cairo-timezone-constraint: that split has been the same
    // recurring bug across a dozen services, and a hardcoded '2026-08-*'
    // string here would just go stale the moment the seed outlives the month.
    console.log('🔮 Seeding weekly predictions...');
    const todayStr = getBusinessDateString();
    const predictionsData: any[] = [];
    for (let i = 0; i < 20; i++) {
      const prod = allProducts[i % allProducts.length];
      const weekStartOffset = ((i % 4) - 2) * 7;
      const weekStart = addDaysToDateString(todayStr, weekStartOffset);
      predictionsData.push({
        restaurantId: prod.restaurantId,
        productId: prod._id,
        modelVersionId: 'v1.2.0',
        targetWeek: weekStart,
        predictedOrders: 100 + i * 12,
        confidence: i % 3 === 0 ? ConfidenceLevelEnum.HIGH : i % 2 === 0 ? ConfidenceLevelEnum.MEDIUM : ConfidenceLevelEnum.LOW,
        source: i % 2 === 0 ? PredictionSourceEnum.AI_MODEL : PredictionSourceEnum.FALLBACK_NAIVE,
        featuresUsed: { seasonality: true, lag_7: 100 + i * 10 },
        dailyBreakdown: [0, 1, 2, 3, 4].map((d) => ({
          date: addDaysToDateString(weekStart, d),
          predictedQuantity: 15 + i + d * 2,
        })),
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
      const dateStr = addDaysToDateString(todayStr, i - 20);
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
            confidence: i % 2 === 0 ? ConfidenceLevelEnum.HIGH : ConfidenceLevelEnum.MEDIUM,
            source: i % 2 === 0 ? ProductionPlanSourceEnum.AI_MODEL : ProductionPlanSourceEnum.FALLBACK_YESTERDAY,
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
    const importTypes = [
      ImportTypeEnum.SALES_HISTORY,
      ImportTypeEnum.INVENTORY_TRANSACTIONS,
      ImportTypeEnum.RECIPES,
      ImportTypeEnum.MENU_ITEMS,
      ImportTypeEnum.INGREDIENTS,
    ];
    const importStatuses = [
      ImportJobStatusEnum.PROCESSING,
      ImportJobStatusEnum.VALIDATED,
      ImportJobStatusEnum.AI_INGEST_PENDING,
      ImportJobStatusEnum.COMPLETED,
      ImportJobStatusEnum.FAILED,
    ];
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
    // Predictions span all 21 restaurants, but ingredients only exist for
    // managerRestaurantId — pairing an out-of-restaurant prediction with an
    // ingredient here would make a waste report whose own restaurantId
    // doesn't own either the prediction or the ingredient it references.
    console.log('📊 Seeding waste reports...');
    const riskLevels = [RiskLevelEnum.LOW, RiskLevelEnum.MEDIUM, RiskLevelEnum.HIGH];
    const managerPredictions = insertedPredictions.filter((p) => p.restaurantId.equals(managerRestaurantId));
    const wasteReportData: any[] = [];
    for (let i = 0; i < 20; i++) {
      const ing = insertedIngredients[i % insertedIngredients.length];
      const pred = managerPredictions[i % managerPredictions.length];
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
    const recTypes = [
      RecommendationTypeEnum.APPLY_DISCOUNT,
      RecommendationTypeEnum.REDUCE_PURCHASE,
      RecommendationTypeEnum.STOP_PRODUCTION,
      RecommendationTypeEnum.TRANSFER_STOCK,
    ];
    const recStatuses = [
      RecommendationStatusEnum.PENDING,
      RecommendationStatusEnum.APPROVED,
      RecommendationStatusEnum.EDITED,
      RecommendationStatusEnum.DISMISSED,
    ];
    // wr always belongs to managerRestaurantId (see step 22), so the
    // recommended product must too — otherwise approving an APPLY_DISCOUNT
    // recommendation would create an Offer under the approving manager's
    // restaurant for a product it doesn't own (recommendations.service.ts
    // approve() reads productId without checking it belongs to restaurantId).
    const recData: any[] = [];
    for (let i = 0; i < 20; i++) {
      const wr = insertedWasteReports[i % insertedWasteReports.length];
      const prod = managerProducts[i % managerProducts.length];
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
        otpType: i % 2 === 0 ? OtpTypeEnum.CONFIRMATION : OtpTypeEnum.RESET_PASSWORD,
        expireTime: new Date(Date.now() + 15 * 60 * 1000),
      });
    }
    const insertedOtps = await OtpModel.insertMany(otpsData);
    console.log(`✅ OTPs seeded: ${insertedOtps.length}`);

    // ─── 24b. Seed Revoked Tokens (Total Revoked Tokens >= 10) ─────────────────────
    console.log('🔒 Seeding revoked tokens...');
    const revokedTokensData: any[] = [];
    for (let i = 0; i < 10; i++) {
      revokedTokensData.push({
        tokenId: `TOKEN-REV-2026-${String(i + 1).padStart(4, '0')}`,
        userId: allUserIds[i % allUserIds.length],
        expiryTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }
    const insertedRevokedTokens = await RevokeTokenModel.insertMany(revokedTokensData);
    console.log(`✅ Revoked Tokens seeded: ${insertedRevokedTokens.length}`);

    // ─── 25. Seed Partnership Applications (Total Applications >= 20) ──────────────
    console.log('🤝 Seeding partnership applications...');
    const businessTypes = [
      BusinessTypeEnum.BAKERY,
      BusinessTypeEnum.RESTAURANT,
      BusinessTypeEnum.CAFE,
      BusinessTypeEnum.CATERING,
      BusinessTypeEnum.SUPERMARKET,
    ];
    const appStatuses = [
      PartnershipApplicationStatusEnum.PENDING,
      PartnershipApplicationStatusEnum.UNDER_REVIEW,
      PartnershipApplicationStatusEnum.APPROVED,
      PartnershipApplicationStatusEnum.REJECTED,
      PartnershipApplicationStatusEnum.ONBOARDED,
    ];
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
      const isApproved = status === PartnershipApplicationStatusEnum.APPROVED || status === PartnershipApplicationStatusEnum.ONBOARDED;
      const isRejected = status === PartnershipApplicationStatusEnum.REJECTED;

      partnershipAppsData.push({
        businessName: app.bName,
        businessType: businessTypes[i % businessTypes.length],
        description: `High-capacity ${businessTypes[i % businessTypes.length]} looking to join RestoMind surplus recovery platform.`,
        estimatedOrdersPerDay: 50 + i * 15,
        estimatedWasteKgPerDay: 5 + i * 2,
        ownerFirstName: app.first,
        ownerLastName: app.last,
        email: `${app.first.toLowerCase()}.${app.last.toLowerCase()}@partnerdomain.com`,
        phone: egyptPhone(4000 + i),
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
          ? (() => {
              // The real onboarding flow (partnership-applications.service.ts
              // approve()) creates userId and restaurantId together, with
              // userId as restaurantId's ownerUserId — an application whose
              // userId owns a DIFFERENT restaurant than the one it names
              // would send a setup-account token to the wrong person.
              const linkedRestaurantId = allRestaurantIds[i % allRestaurantIds.length];
              const linkedOwnerId =
                allRestaurants.find((r) => r._id.equals(linkedRestaurantId))?.ownerUserId ??
                adminUser._id;
              return {
                reviewedBy: adminUser._id,
                approvedBy: adminUser._id,
                approvedAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
                userId: linkedOwnerId,
                restaurantId: linkedRestaurantId,
              };
            })()
          : {}),
        isDeleted: false,
      });
    }
    const insertedPartnershipApps = await PartnershipApplicationModel.insertMany(partnershipAppsData);
    console.log(`✅ Partnership Applications seeded: ${insertedPartnershipApps.length}`);

    // ─── 26. Seed Payments (Total Payments >= 20) ──────────────────────────────────
    console.log('💳 Seeding payment transactions...');
    const paymentsData: any[] = [];
    const payStatuses = [
      PaymentStatusEnum.PAID,
      PaymentStatusEnum.PENDING,
      PaymentStatusEnum.PAID,
      PaymentStatusEnum.FAILED,
      PaymentStatusEnum.EXPIRED,
    ];

    // One payment per online group, so every online order has a settled
    // payment behind it. Without this the payout statement reports every
    // delivered card order as a `delivered_unpaid` exception instead of paying
    // it, and the whole merchant balance reads as zero.
    payableGroups.forEach((group, i) => {
      const status = payStatuses[i % payStatuses.length];
      paymentsData.push({
        purpose: PaymentPurposeEnum.ORDER,
        orderGroupId: group._id,
        userId: customerUser._id,
        // Must equal the group total: `resolveAmountCents` refunds
        // `amountCents - refundedAmountCents` for a whole-group refund.
        amountCents: Math.round(group.finalTotalPrice * 100),
        currency: 'EGP',
        method:
          group.paymentMethod === 'Card'
            ? PaymentMethodEnum.CARD
            : PaymentMethodEnum.WALLET,
        integrationId: 100000 + i,
        specialReference: `PAY-REF-2026-${String(i + 1).padStart(4, '0')}`,
        paymobTransactionId: status === PaymentStatusEnum.PAID ? 800000 + i : undefined,
        paymobOrderId: 900000 + i,
        status,
        refundedAmountCents: 0,
        hmacVerifiedAt: status === PaymentStatusEnum.PAID ? new Date(Date.now() - i * 6 * 60 * 60 * 1000) : undefined,
        createdAt: group.createdAt,
      });
    });

    // Subscription payments — the only revenue on the admin dashboard that is
    // actually RestoMind's, alongside commission. Spread over the last three
    // months so a 7d/30d window comparison has something to compare.
    // Tier/price come straight from SUBSCRIPTION_PLANS, the same table just
    // seeded into `subscriptionplans` — a made-up 'starter' slug or price
    // here would desync from the plan the restaurant docs actually reference.
    for (let i = 0; i < 12; i++) {
      const restId = allRestaurantIds[i % allRestaurantIds.length];
      const plan = SUBSCRIPTION_PLANS[i % SUBSCRIPTION_PLANS.length];
      const paidAt = new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000);

      paymentsData.push({
        purpose: PaymentPurposeEnum.SUBSCRIPTION,
        restaurantId: restId,
        tier: plan.slug,
        planLabel: plan.label,
        interval: 'monthly',
        periodStart: paidAt,
        periodEnd: new Date(paidAt.getTime() + 30 * 24 * 60 * 60 * 1000),
        userId: allRestaurants.find((r) => r._id.equals(restId))?.ownerUserId || adminUser._id,
        amountCents: plan.prices.monthly,
        currency: 'EGP',
        method: PaymentMethodEnum.CARD,
        integrationId: 200000 + i,
        specialReference: `SUB-REF-2026-${String(i + 1).padStart(4, '0')}`,
        paymobTransactionId: 810000 + i,
        paymobOrderId: 910000 + i,
        status: PaymentStatusEnum.PAID,
        refundedAmountCents: 0,
        hmacVerifiedAt: paidAt,
        createdAt: paidAt,
      });
    }

    const insertedPayments = await PaymentModel.insertMany(paymentsData);
    console.log(`✅ Payments seeded: ${insertedPayments.length}`);

    // ─── 27. Seed Refunds (Total Refunds >= 10) ────────────────────────────────────
    console.log('💸 Seeding refund transactions...');
    const refundsData: any[] = [];
    const refundStatuses = [
      RefundStatusEnum.SUCCEEDED,
      RefundStatusEnum.REQUESTED,
      RefundStatusEnum.APPROVED,
      RefundStatusEnum.REJECTED,
      RefundStatusEnum.PROCESSING,
    ];

    const paidPayments = insertedPayments.filter((p) => p.status === PaymentStatusEnum.PAID && p.purpose === PaymentPurposeEnum.ORDER);
    const groupTotalsById = new Map(
      orderGroupsData.map((g) => [String(g._id), Math.round(g.finalTotalPrice * 100)]),
    );

    for (let i = 0; i < paidPayments.length; i++) {
      const pay = paidPayments[i];
      const status = refundStatuses[i % refundStatuses.length];
      // Capped at the payment: a refund larger than what was actually paid is
      // rejected by `reserveRefund` in real life, so seeding one produces a
      // row the application itself considers impossible.
      const groupTotal = groupTotalsById.get(String(pay.orderGroupId)) ?? pay.amountCents;
      const amountCents = Math.min(2000 + i * 500, groupTotal);

      refundsData.push({
        paymentId: pay._id,
        orderGroupId: pay.orderGroupId,
        amountCents,
        reason: i % 2 === 0 ? 'Customer order item damaged in transport' : 'Incorrect item delivered by restaurant',
        // Every one of these is against an online payment, so GATEWAY is
        // correct here — a COD group would need OFFLINE and no paymentId.
        settlementMode: RefundSettlementModeEnum.GATEWAY,
        status,
        // Refunds are a support action now, so admin initiates and reviews.
        initiatedBy: adminUser._id,
        reviewedBy: status !== RefundStatusEnum.REQUESTED ? adminUser._id : undefined,
        reviewedAt: status !== RefundStatusEnum.REQUESTED ? new Date() : undefined,
        // Dated inside the payout window so a succeeded refund actually shows
        // up as a reversal line on the merchant's statement.
        completedAt:
          status === RefundStatusEnum.SUCCEEDED
            ? new Date(Date.now() - (10 + i) * 24 * 60 * 60 * 1000)
            : undefined,
        gatewayOperation: 'refund',
        paymobRefundTransactionId: status === RefundStatusEnum.SUCCEEDED ? 850000 + i : undefined,
      });
    }
    const insertedRefunds = await RefundModel.insertMany(refundsData);
    console.log(`✅ Refunds seeded: ${insertedRefunds.length}`);

    // The reservation the application would have taken when each refund was
    // requested. Left at 0, a whole-group refund would offer the full amount
    // again on top of what is already refunded.
    for (const refund of insertedRefunds) {
      if (
        refund.status === RefundStatusEnum.REJECTED ||
        refund.status === RefundStatusEnum.FAILED
      ) {
        continue;
      }
      await PaymentModel.updateOne(
        { _id: refund.paymentId },
        { $inc: { refundedAmountCents: refund.amountCents } },
      );
    }

    // ─── 28. Seed Payouts (Total Payouts >= 10) ───────────────────────────────────
    console.log('🏦 Seeding merchant payouts...');
    const payoutsData: any[] = [];
    const payoutStatuses = [
      PayoutStatusEnum.COMPLETED,
      PayoutStatusEnum.PENDING,
      PayoutStatusEnum.COMPLETED,
      PayoutStatusEnum.FAILED,
    ];

    for (let i = 0; i < Math.min(10, allRestaurants.length); i++) {
      const rest = allRestaurants[i];
      const status = payoutStatuses[i % payoutStatuses.length];
      const periodStart = new Date(Date.now() - (i + 2) * 7 * 24 * 60 * 60 * 1000);
      const periodEnd = new Date(Date.now() - (i + 1) * 7 * 24 * 60 * 60 * 1000);

      payoutsData.push({
        restaurantId: rest._id,
        periodStart,
        periodEnd,
        amountCents: 350000 + i * 45000,
        direction: PayoutDirectionEnum.TO_MERCHANT,
        lines: [
          { type: 'gross_sales', amountCents: 400000 + i * 50000 },
          { type: 'commission_deducted', amountCents: -(40000 + i * 5000) },
        ],
        commissionNetCents: 35087 + i * 4385,
        commissionVatCents: 4912 + i * 614,
        reference: status === PayoutStatusEnum.COMPLETED ? `CIB-TRF-2026-${1000 + i}` : undefined,
        recordedBy: adminUser._id,
        status,
        completedAt: status === PayoutStatusEnum.COMPLETED ? periodEnd : undefined,
        failureReason: status === PayoutStatusEnum.FAILED ? 'Invalid bank IBAN length provided' : undefined,
      });
    }
    const insertedPayouts = await PayoutModel.insertMany(payoutsData);
    console.log(`✅ Payouts seeded: ${insertedPayouts.length}`);

    // ─── 29. Seed Merchant Adjustments (Total Adjustments >= 10) ──────────────────
    console.log('⚖️ Seeding merchant adjustments...');
    const adjustmentsData: any[] = [];
    const adjReasons = [
      'Goodwill credit for customer service delay',
      'Commission adjustment on cash sales refund',
      'Late chargeback recovery debit',
      'Special promotional platform rebate',
      'Adjustment for manual order discrepancy',
    ];

    for (let i = 0; i < 10; i++) {
      const rest = allRestaurants[i % allRestaurants.length];
      adjustmentsData.push({
        restaurantId: rest._id,
        amountCents: (i % 2 === 0 ? 1 : -1) * (2500 + i * 500),
        reason: adjReasons[i % adjReasons.length],
        effectiveAt: new Date(Date.now() - i * 2 * 24 * 60 * 60 * 1000),
        createdBy: adminUser._id,
      });
    }
    const insertedAdjustments = await MerchantAdjustmentModel.insertMany(adjustmentsData);
    console.log(`✅ Merchant Adjustments seeded: ${insertedAdjustments.length}`);

    // ─── 30. Seed Notifications (Total Notifications >= 20) ───────────────────────
    console.log('🔔 Seeding notifications...');
    const notificationsData: any[] = [];
    insertedOrders.slice(0, 15).forEach((order: any, i: number) => {
      const rest = allRestaurants.find((r) => r._id.equals(order.restaurantId));
      notificationsData.push({
        userId: rest?.ownerUserId || managerUser._id,
        role: 'manager',
        restaurantId: order.restaurantId,
        type: NotificationType.NEW_ORDER,
        title: 'New order received',
        message: `Order for ${order.finalTotalPrice} EGP was placed by ${order.fullName}.`,
        relatedEntityId: order._id,
        relatedEntityType: 'Order',
        isRead: i % 3 === 0,
        readAt: i % 3 === 0 ? new Date() : null,
      });
    });
    insertedPartnershipApps.slice(0, 10).forEach((app: any, i: number) => {
      notificationsData.push({
        userId: adminUser._id,
        role: 'admin',
        type: NotificationType.NEW_PARTNERSHIP_APPLICATION,
        title: 'New partnership application',
        message: `${app.businessName} applied to join RestoMind.`,
        relatedEntityId: app._id,
        relatedEntityType: 'PartnershipApplication',
        isRead: i % 4 === 0,
        readAt: i % 4 === 0 ? new Date() : null,
      });
    });
    const insertedNotifications = await NotificationModel.insertMany(notificationsData);
    console.log(`✅ Notifications seeded: ${insertedNotifications.length}`);

    // ─── 31. Seed Weekly Executive Snapshots (one per restaurant) ─────────────────
    console.log('📈 Seeding weekly executive snapshots...');
    const snapshotData = allRestaurants.map((rest, i) => {
      const restProducts = allProducts.filter((p) => p.restaurantId.equals(rest._id));
      const topProduct = restProducts[0] || allProducts[i % allProducts.length];
      const topIngredient = insertedIngredients[i % insertedIngredients.length];
      const totalSalesRevenue = 5000 + i * 350;
      const totalWasteCost = 200 + i * 15;
      const aiPredictionAccuracy = 78 + (i % 15);
      return {
        restaurantId: rest._id,
        targetWeek: todayStr,
        totalSalesRevenue,
        totalWasteCost,
        topWastedIngredient: topIngredient.name,
        topSellingProduct: topProduct.title,
        aiPredictionAccuracy,
        narrativeSummary: `Weekly Executive Summary for ${rest.name}: Total Sales Revenue: ${totalSalesRevenue.toFixed(2)} EGP. Total Waste Cost: ${totalWasteCost.toFixed(2)} EGP. Primary Waste Driver: Ingredient [${topIngredient.name}]. Top Performing Item: Product [${topProduct.title}]. AI Forecasting Accuracy: ${aiPredictionAccuracy}%.`,
        isDeleted: false,
      };
    });
    const insertedSnapshots = await WeeklyExecutiveSnapshotModel.insertMany(snapshotData);
    console.log(`✅ Weekly Executive Snapshots seeded: ${insertedSnapshots.length}`);

    // ─── 32. Seed Assistant Action Logs (Total Logs >= 20) ────────────────────────
    console.log('🤖 Seeding assistant action logs...');
    const actionTools = ['createOffer', 'scheduleDiscount', 'createPurchaseOrder', 'updateProductionPlan', 'sendNotification'];
    const execStatuses = ['SUCCESS', 'SUCCESS', 'SUCCESS', 'FAILED', 'REJECTED_BY_USER', 'PENDING_APPROVAL'];
    const actionLogData: any[] = [];
    for (let i = 0; i < 20; i++) {
      const rest = allRestaurants[i % allRestaurants.length];
      const status = execStatuses[i % execStatuses.length];
      actionLogData.push({
        restaurantId: rest._id,
        userId: rest.ownerUserId || managerUser._id,
        sessionId: `session-${rest._id.toString().slice(-6)}-${i}`,
        toolName: actionTools[i % actionTools.length],
        arguments: { restaurantId: rest._id.toString() },
        executionStatus: status,
        durationMs: 200 + i * 35,
        modelUsed: 'claude-sonnet-4-5',
        executionResult: status === 'SUCCESS' ? { applied: true } : null,
        errorMessage: status === 'FAILED' ? 'Downstream service timeout' : null,
      });
    }
    const insertedActionLogs = await AssistantActionLogModel.insertMany(actionLogData);
    console.log(`✅ Assistant Action Logs seeded: ${insertedActionLogs.length}`);

    // ─── 33. Seed Recommendation Actions (one per Recommendation) ─────────────────
    console.log('📌 Seeding recommendation actions...');
    const relatedToolByRecType: Record<string, string> = {
      [RecommendationTypeEnum.APPLY_DISCOUNT]: 'scheduleDiscount',
      [RecommendationTypeEnum.REDUCE_PURCHASE]: 'createPurchaseOrder',
      [RecommendationTypeEnum.STOP_PRODUCTION]: 'updateProductionPlan',
      [RecommendationTypeEnum.TRANSFER_STOCK]: 'updateProductionPlan',
    };
    const actionStatusByRecStatus: Record<string, string> = {
      [RecommendationStatusEnum.PENDING]: 'PENDING',
      [RecommendationStatusEnum.APPROVED]: 'EXECUTED',
      [RecommendationStatusEnum.EDITED]: 'APPROVED',
      [RecommendationStatusEnum.DISMISSED]: 'REJECTED',
    };
    const recommendationActionData = insertedRecommendations.map((rec: any, i: number) => {
      const status = actionStatusByRecStatus[rec.status] ?? 'PENDING';
      const isActedOn = status !== 'PENDING';
      return {
        restaurantId: rec.restaurantId,
        recommendationId: rec._id,
        status,
        selectedByUser: isActedOn,
        actedBy: isActedOn ? managerUser._id : null,
        executedAt: status === 'EXECUTED' ? new Date(Date.now() - i * 3 * 60 * 60 * 1000) : null,
        relatedTool: relatedToolByRecType[rec.type] ?? 'updateProductionPlan',
        executionResult: status === 'EXECUTED' ? { applied: true } : null,
      };
    });
    const insertedRecommendationActions = await RecommendationActionModel.insertMany(recommendationActionData);
    console.log(`✅ Recommendation Actions seeded: ${insertedRecommendationActions.length}`);

    // ─── 34. Seed Assistant Chat Histories ─────────────────────────────────────────
    console.log('💬 Seeding assistant chat histories...');
    const chatHistoryData = allRestaurants.slice(0, 10).map((rest, i) => {
      const baseTime = new Date(Date.now() - (10 - i) * 60 * 60 * 1000);
      return {
        restaurantId: rest._id,
        userId: rest.ownerUserId || managerUser._id,
        sessionId: `chat-${rest._id.toString().slice(-8)}`,
        messages: [
          {
            role: 'user',
            content: 'What should I do about ingredients close to expiry this week?',
            timestamp: baseTime,
          },
          {
            role: 'assistant',
            content: 'I found ingredients nearing expiry. I recommend scheduling a discount on the related products to move stock before it spoils.',
            toolCalls: [{ name: 'scheduleDiscount', status: 'SUCCESS' }],
            timestamp: new Date(baseTime.getTime() + 5000),
          },
        ],
      };
    });
    const insertedChatHistories = await AssistantChatHistoryModel.insertMany(chatHistoryData);
    console.log(`✅ Assistant Chat Histories seeded: ${insertedChatHistories.length}`);

    // KnowledgeVector is intentionally left empty: a real row needs an actual
    // 1024-dim embedding from the AI provider (see knowledge-vector.model.ts).
    // Faking one with random floats would just be noise no vector search
    // could ever meaningfully match, and generating a real one means calling
    // the AI provider from a seed script. If $vectorSearch needs sample data,
    // run the app's normal ingestion path (e.g. the weekly snapshot job)
    // against the seeded restaurants instead.

    console.log('\n======================================================');
    console.log('🎉 DATABASE SEEDING COMPLETED SUCCESSFULLY!');
    console.log('======================================================');
    console.log('🔑 CREATED ACCOUNTS CREDENTIALS:');
    console.log('------------------------------------------------------');
    console.log('1️⃣ ADMIN ACCOUNT:');
    console.log('   Email: admin@restomind.com');
    console.log('   Password: Admin@123');
    console.log('   Role: admin\n');
    console.log('2️⃣ MANAGER ACCOUNT:');
    console.log('   Email: manager@restomind.com');
    console.log('   Password: Manager@123');
    console.log('   Role: manager');
    console.log('   Restaurant: RestoMind Bakery & Cafe\n');
    console.log('3️⃣ CUSTOMER ACCOUNT:');
    console.log('   Email: sara@example.com');
    console.log('   Password: Customer@123');
    console.log('   Role: customer');
    console.log('======================================================\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

seed();
