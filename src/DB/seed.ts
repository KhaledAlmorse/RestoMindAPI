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
} from './Models';

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
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
      commissionRate: 0.10,
      payoutDestination: {
        method: 'bank',
        accountName: 'RestoMind Bakery & Cafe Ltd',
        accountNumber: 'EG1234567890123456789012345',
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
      subscription: {
        tier: i % 2 === 0 ? 'scale' : 'plus',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      commissionRate: 0.10,
      payoutDestination: {
        method: 'bank',
        accountName: `${n} Account`,
        accountNumber: `EG${String(900000000000000000000000 + i)}`,
        bankName: 'National Bank of Egypt',
      },
      isActive: true,
      isDeleted: false,
    }));
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
        confidence: i % 3 === 0 ? ConfidenceLevelEnum.HIGH : i % 2 === 0 ? ConfidenceLevelEnum.MEDIUM : ConfidenceLevelEnum.LOW,
        source: i % 2 === 0 ? PredictionSourceEnum.AI_MODEL : PredictionSourceEnum.FALLBACK_NAIVE,
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
    console.log('📊 Seeding waste reports...');
    const riskLevels = [RiskLevelEnum.LOW, RiskLevelEnum.MEDIUM, RiskLevelEnum.HIGH];
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
    const subTiers = ['starter', 'plus', 'scale'];
    const subPrices = [29900, 49900, 99900];
    for (let i = 0; i < 12; i++) {
      const restId = allRestaurantIds[i % allRestaurantIds.length];
      const tierIndex = i % subTiers.length;
      const paidAt = new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000);

      paymentsData.push({
        purpose: PaymentPurposeEnum.SUBSCRIPTION,
        restaurantId: restId,
        tier: subTiers[tierIndex],
        planLabel: subTiers[tierIndex].replace(/^./, (c) => c.toUpperCase()),
        interval: 'monthly',
        periodStart: paidAt,
        periodEnd: new Date(paidAt.getTime() + 30 * 24 * 60 * 60 * 1000),
        userId: allRestaurants.find((r) => r._id.equals(restId))?.ownerUserId || adminUser._id,
        amountCents: subPrices[tierIndex],
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
