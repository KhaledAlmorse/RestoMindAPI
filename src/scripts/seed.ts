import * as dotenv from 'dotenv';
import mongoose, { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import slugify from 'slugify';

dotenv.config();

const DB_URL = process.env.DB_URL;

if (!DB_URL) {
  console.error('DB_URL is not defined in environment variables.');
  process.exit(1);
}

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

async function seed() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(DB_URL as string);
  console.log('Connected successfully.');

  const db = mongoose.connection.db;
  if (!db) {
    console.error('Database connection failed.');
    process.exit(1);
  }

  // Define collection handles
  const usersColl = db.collection('users');
  const restaurantsColl = db.collection('restaurants');
  const categoriesColl = db.collection('categories');
  const ingredientsColl = db.collection('ingredients');
  const productsColl = db.collection('products');
  const recipesColl = db.collection('recipes');
  const suppliersColl = db.collection('suppliers');
  const purchaseOrdersColl = db.collection('purchaseorders');
  const inventoryBatchesColl = db.collection('inventorybatches');
  const stockTransactionsColl = db.collection('stocktransactions');
  const wasteEventsColl = db.collection('wasteevents');
  const salesTransactionsColl = db.collection('salestransactions');
  const offersColl = db.collection('offers');

  console.log('\n--- Seeding Users ---');

  // 1. Admin User
  const adminEmail = 'admin@restomind.com';
  let adminUser = await usersColl.findOne({ email: adminEmail });
  if (!adminUser) {
    const adminId = new Types.ObjectId();
    adminUser = {
      _id: adminId,
      firstName: 'System',
      lastName: 'Admin',
      email: adminEmail,
      password: hashPassword('Password123!'),
      role: 'admin',
      gender: 'male',
      phone: '+201000000001',
      isEmailVerified: true,
      DOB: new Date('1990-01-01'),
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await usersColl.insertOne(adminUser);
    console.log(`✅ Admin Created: ${adminEmail} (Password: Password123!)`);
  } else {
    console.log(`ℹ️ Admin already exists: ${adminEmail}`);
  }

  // 2. Manager User
  const managerEmail = 'manager@restomind.com';
  let managerUser = await usersColl.findOne({ email: managerEmail });
  const managerId = managerUser ? managerUser._id : new Types.ObjectId();
  if (!managerUser) {
    managerUser = {
      _id: managerId,
      firstName: 'Bakery',
      lastName: 'Manager',
      email: managerEmail,
      password: hashPassword('Password123!'),
      role: 'manager',
      gender: 'male',
      phone: '+201000000002',
      isEmailVerified: true,
      DOB: new Date('1992-05-15'),
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await usersColl.insertOne(managerUser);
    console.log(`✅ Manager Created: ${managerEmail} (Password: Password123!)`);
  } else {
    console.log(`ℹ️ Manager already exists: ${managerEmail}`);
  }

  console.log('\n--- Seeding Restaurant ---');
  let restaurant = await restaurantsColl.findOne({ ownerUserId: managerId });
  const restaurantId = restaurant ? restaurant._id : new Types.ObjectId();
  if (!restaurant) {
    restaurant = {
      _id: restaurantId,
      name: 'El-Sultan Bakery',
      nameAr: 'مخبز السلطان',
      ownerUserId: managerId,
      address: '15 Tahrir Square, Cairo',
      phone: '+201234567890',
      isActive: true,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await restaurantsColl.insertOne(restaurant);
    await usersColl.updateOne(
      { _id: managerId },
      { $set: { restaurantId: restaurantId } },
    );
    console.log(`✅ Restaurant Created: El-Sultan Bakery`);
  } else {
    console.log(`ℹ️ Restaurant already exists: El-Sultan Bakery`);
  }

  console.log('\n--- Seeding Categories ---');
  const catDefs = [
    {
      name: 'معجنات',
      description: 'أشهى المعجنات والمخبوزات الطازجة',
      image: {
        public_id: 'restomind/categories/pastries',
        secure_url:
          'https://res.cloudinary.com/demo/image/upload/v1600000000/pastries.jpg',
      },
    },
    {
      name: 'حلويات شرقية',
      description: 'حلويات شرقية فاخرة بالسمن البلدي',
      image: {
        public_id: 'restomind/categories/sweets',
        secure_url:
          'https://res.cloudinary.com/demo/image/upload/v1600000000/sweets.jpg',
      },
    },
    {
      name: 'خبز',
      description: 'خبز طازج يومياً',
      image: {
        public_id: 'restomind/categories/bread',
        secure_url:
          'https://res.cloudinary.com/demo/image/upload/v1600000000/bread.jpg',
      },
    },
  ];
  const categoriesMap: Record<string, Types.ObjectId> = {};

  for (const catDef of catDefs) {
    let cat = await categoriesColl.findOne({
      name: catDef.name,
      isDeleted: false,
    });
    if (!cat) {
      const catId = new Types.ObjectId();
      cat = {
        _id: catId,
        name: catDef.name,
        description: catDef.description,
        image: catDef.image,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await categoriesColl.insertOne(cat);
      console.log(`✅ Category Created: ${catDef.name}`);
    }
    categoriesMap[catDef.name] = cat._id;
  }

  console.log('\n--- Seeding Ingredients ---');
  const ingredientData = [
    {
      code: 'ING-001',
      name: 'دقيق فاخر',
      unit: 'kg',
      shelfLifeDays: 90,
      minimumStock: 50,
      safetyStock: 20,
    },
    {
      code: 'ING-002',
      name: 'زبده بلدي',
      unit: 'kg',
      shelfLifeDays: 60,
      minimumStock: 20,
      safetyStock: 10,
    },
    {
      code: 'ING-003',
      name: 'سكر',
      unit: 'kg',
      shelfLifeDays: 365,
      minimumStock: 30,
      safetyStock: 15,
    },
    {
      code: 'ING-004',
      name: 'لبن',
      unit: 'liter',
      shelfLifeDays: 7,
      minimumStock: 10,
      safetyStock: 5,
    },
  ];

  const ingredientsMap: Record<string, Types.ObjectId> = {};

  for (const ingData of ingredientData) {
    let ing = await ingredientsColl.findOne({
      restaurantId,
      ingredientCode: ingData.code,
      isDeleted: false,
    });
    if (!ing) {
      const ingId = new Types.ObjectId();
      ing = {
        _id: ingId,
        restaurantId,
        ingredientCode: ingData.code,
        name: ingData.name,
        unit: ingData.unit,
        shelfLifeDays: ingData.shelfLifeDays,
        minimumStock: ingData.minimumStock,
        safetyStock: ingData.safetyStock,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ingredientsColl.insertOne(ing);
      console.log(`✅ Ingredient Created: ${ingData.name}`);
    }
    ingredientsMap[ingData.code] = ing._id;
  }

  console.log('\n--- Seeding Products ---');
  const productDefs = [
    {
      title: 'كرواسون بالزبده',
      slug: 'croissant-butter-' + restaurantId.toString().slice(-4),
      description: 'كرواسون فرنسي هش بالسمن البلدي',
      longDescription: 'كرواسون طازج يخبز يومياً بالزبده والفرن البلدي',
      price: 25,
      categoryName: 'معجنات',
      freshnessWindow: 2,
      image: {
        public_id: 'restomind/products/croissant',
        secure_url:
          'https://res.cloudinary.com/demo/image/upload/v1600000000/croissant.jpg',
      },
    },
    {
      title: 'كنافة بالمكسرات',
      slug: 'kunafa-nuts-' + restaurantId.toString().slice(-4),
      description: 'كنافة شرقية محشوة مكسرات مشكلة',
      longDescription: 'كنافة غرقانة بالسمن البلدي والعسل والمكسرات',
      price: 65,
      categoryName: 'حلويات شرقية',
      freshnessWindow: 3,
      image: {
        public_id: 'restomind/products/kunafa',
        secure_url:
          'https://res.cloudinary.com/demo/image/upload/v1600000000/kunafa.jpg',
      },
    },
    {
      title: 'عيش بلدي',
      slug: 'baladi-bread-' + restaurantId.toString().slice(-4),
      description: 'خبز بلدي طازج مخبوز بالردة',
      longDescription: 'عيش بلدي ساخن من الفرن مباشر',
      price: 5,
      categoryName: 'خبز',
      freshnessWindow: 1,
      image: {
        public_id: 'restomind/products/bread',
        secure_url:
          'https://res.cloudinary.com/demo/image/upload/v1600000000/bread.jpg',
      },
    },
  ];

  const productsMap: Record<string, Types.ObjectId> = {};

  for (const pDef of productDefs) {
    let prod = await productsColl.findOne({
      restaurantId,
      title: pDef.title,
      isDeleted: false,
    });
    if (!prod) {
      const prodId = new Types.ObjectId();
      prod = {
        _id: prodId,
        restaurantId,
        title: pDef.title,
        slug: pDef.slug,
        description: pDef.description,
        longDescription: pDef.longDescription,
        price: pDef.price,
        rating: 4.8,
        reviewsCount: 12,
        isBestseller: true,
        isAvailable: true,
        freshnessWindow: pDef.freshnessWindow,
        image: pDef.image,
        category: categoriesMap[pDef.categoryName],
        tags: ['طازج', 'مخبوزات'],
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await productsColl.insertOne(prod);
      console.log(`✅ Product Created: ${pDef.title}`);
    }
    productsMap[pDef.title] = prod._id;
  }

  console.log('\n--- Seeding Recipes ---');
  if (productsMap['كرواسون بالزبده']) {
    const recipeCroissant = await recipesColl.findOne({
      productId: productsMap['كرواسون بالزبده'],
      isDeleted: false,
    });
    if (!recipeCroissant) {
      await recipesColl.insertOne({
        _id: new Types.ObjectId(),
        restaurantId,
        productId: productsMap['كرواسون بالزبده'],
        ingredients: [
          {
            ingredientId: ingredientsMap['ING-001'],
            quantity: 0.15,
            unit: 'kg',
          },
          {
            ingredientId: ingredientsMap['ING-002'],
            quantity: 0.05,
            unit: 'kg',
          },
          {
            ingredientId: ingredientsMap['ING-003'],
            quantity: 0.02,
            unit: 'kg',
          },
        ],
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`✅ Recipe Created for: كرواسون بالزبده`);
    }
  }

  console.log('\n--- Seeding Suppliers ---');
  let supplierAlNahar = await suppliersColl.findOne({
    restaurantId,
    name: 'Al-Nahar Flour Mills',
    isDeleted: false,
  });
  const supplierId = supplierAlNahar
    ? supplierAlNahar._id
    : new Types.ObjectId();
  if (!supplierAlNahar) {
    supplierAlNahar = {
      _id: supplierId,
      restaurantId,
      name: 'Al-Nahar Flour Mills',
      email: 'sales@alnahar.com',
      phone: '+201012345678',
      leadTimeDays: 2,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await suppliersColl.insertOne(supplierAlNahar);
    console.log(`✅ Supplier Created: Al-Nahar Flour Mills`);
  }

  console.log('\n--- Seeding Purchase Order ---');
  let po = await purchaseOrdersColl.findOne({
    restaurantId,
    supplierId,
    isDeleted: false,
  });
  const poId = po ? po._id : new Types.ObjectId();
  if (!po) {
    po = {
      _id: poId,
      restaurantId,
      supplierId,
      items: [
        {
          ingredientId: ingredientsMap['ING-001'],
          quantity: 200,
          unit: 'kg',
          unitCost: 25,
        },
        {
          ingredientId: ingredientsMap['ING-003'],
          quantity: 100,
          unit: 'kg',
          unitCost: 30,
        },
      ],
      status: 'received',
      expectedDeliveryDate: new Date(),
      createdBy: managerId,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await purchaseOrdersColl.insertOne(po);
    console.log(`✅ Purchase Order Created & Marked Received`);
  }

  console.log('\n--- Seeding Inventory Batches ---');
  let batchFlour = await inventoryBatchesColl.findOne({
    restaurantId,
    ingredientId: ingredientsMap['ING-001'],
    isDeleted: false,
  });
  const batchFlourId = batchFlour ? batchFlour._id : new Types.ObjectId();
  if (!batchFlour) {
    batchFlour = {
      _id: batchFlourId,
      restaurantId,
      ingredientId: ingredientsMap['ING-001'],
      batchNumber: 'FLOUR-PO-001',
      quantityRemaining: 185,
      unitCost: 25,
      expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      receivedDate: new Date(),
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await inventoryBatchesColl.insertOne(batchFlour);
    console.log(`✅ Inventory Batch Created: FLOUR-PO-001`);
  }

  console.log('\n--- Seeding Stock Transactions ---');
  const countTx = await stockTransactionsColl.countDocuments({ restaurantId });
  if (countTx === 0) {
    await stockTransactionsColl.insertMany([
      {
        _id: new Types.ObjectId(),
        restaurantId,
        ingredientId: ingredientsMap['ING-001'],
        batchId: batchFlourId,
        transactionType: 'purchase',
        quantity: 200,
        unit: 'kg',
        date: new Date(),
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: new Types.ObjectId(),
        restaurantId,
        ingredientId: ingredientsMap['ING-001'],
        batchId: batchFlourId,
        transactionType: 'consumption',
        quantity: 15,
        unit: 'kg',
        date: new Date(),
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    console.log(`✅ Stock Transactions Logged`);
  }

  console.log('\n--- Seeding Waste Events ---');
  const countWaste = await wasteEventsColl.countDocuments({ restaurantId });
  if (countWaste === 0) {
    await wasteEventsColl.insertOne({
      _id: new Types.ObjectId(),
      restaurantId,
      ingredientId: ingredientsMap['ING-001'],
      batchId: batchFlourId,
      quantity: 2,
      unit: 'kg',
      wasteReason: 'expired',
      estimatedCost: 50,
      date: new Date(),
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`✅ Waste Event Logged`);
  }

  console.log('\n--- Seeding Sales Transactions ---');
  const countSales = await salesTransactionsColl.countDocuments({
    restaurantId,
  });
  if (countSales === 0) {
    await salesTransactionsColl.insertMany([
      {
        _id: new Types.ObjectId(),
        restaurantId,
        productId: productsMap['كرواسون بالزبده'],
        date: new Date(),
        quantitySold: 40,
        basePrice: 25,
        sellingPrice: 25,
        promotionActive: false,
        source: 'pos_sync',
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: new Types.ObjectId(),
        restaurantId,
        productId: productsMap['كنافة بالمكسرات'],
        date: new Date(),
        quantitySold: 15,
        basePrice: 65,
        sellingPrice: 65,
        promotionActive: false,
        source: 'pos_sync',
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    console.log(`✅ Sales Transactions Logged`);
  }

  console.log('\n--- Seeding Offers ---');
  const offer = await offersColl.findOne({ restaurantId, isDeleted: false });
  if (!offer && productsMap['كنافة بالمكسرات']) {
    await offersColl.insertOne({
      _id: new Types.ObjectId(),
      restaurantId,
      title: 'خصم رمضان على الكنافة',
      productId: productsMap['كنافة بالمكسرات'],
      discountPercentage: 20,
      status: 'active',
      source: 'manual',
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`✅ Offer Created: 20% off Kunafa`);
  }

  console.log('\n======================================================');
  console.log('🎉 SEEDING COMPLETED SUCCESSFULLY!');
  console.log('======================================================');
  console.log('🔑 CREATED ACCOUNTS CREDENTIALS:');
  console.log('------------------------------------------------------');
  console.log('1️⃣ ADMIN ACCOUNT:');
  console.log(`   Email: ${adminEmail}`);
  console.log('   Password: Password123!');
  console.log('   Role: admin\n');
  console.log('2️⃣ MANAGER ACCOUNT:');
  console.log(`   Email: ${managerEmail}`);
  console.log('   Password: Password123!');
  console.log('   Role: manager');
  console.log('   Restaurant: El-Sultan Bakery');
  console.log('======================================================\n');

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed script failed:', err);
  mongoose.disconnect();
  process.exit(1);
});
