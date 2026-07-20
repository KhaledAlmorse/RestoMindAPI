import * as dotenv from 'dotenv';
import mongoose, { Types } from 'mongoose';

dotenv.config();

const DB_URL = process.env.DB_URL;

if (!DB_URL) {
  console.error('DB_URL is not defined in environment variables.');
  process.exit(1);
}

async function migrate() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(DB_URL as string);
  console.log('Connected successfully.');

  const db = mongoose.connection.db;
  if (!db) {
    console.error('Database connection failed.');
    process.exit(1);
  }

  const ordersCollection = db.collection('orders');
  const orderGroupsCollection = db.collection('ordergroups');

  const unlinkedOrders = await ordersCollection
    .find({
      $or: [{ orderGroupId: { $exists: false } }, { orderGroupId: null }],
    })
    .toArray();

  console.log(
    `Found ${unlinkedOrders.length} unlinked legacy orders to migrate.`,
  );

  let count = 0;
  for (const order of unlinkedOrders) {
    const orderGroupId = new Types.ObjectId();

    const orderGroupDoc = {
      _id: orderGroupId,
      userId: order.userId,
      restaurantOrderIds: [order._id],
      fullName: order.fullName || 'Legacy User',
      phoneNumber: order.phoneNumber || '',
      emailAddress: order.emailAddress || '',
      deliveryMethod: order.deliveryMethod || 'Home Delivery',
      deliveryAddress: order.deliveryAddress || null,
      specialNotes: order.specialNotes || '',
      paymentMethod: order.paymentMethod || 'Cash on Delivery',
      totalOriginalPrice: order.totalOriginalPrice || 0,
      totalDiscount: order.totalDiscount || 0,
      finalTotalPrice: order.finalTotalPrice || 0,
      totalQuantity: order.totalQuantity || 0,
      createdAt: order.createdAt || new Date(),
      updatedAt: order.updatedAt || new Date(),
    };

    await orderGroupsCollection.insertOne(orderGroupDoc);
    await ordersCollection.updateOne(
      { _id: order._id },
      { $set: { orderGroupId } },
    );
    count++;
  }

  console.log(`Successfully migrated ${count} legacy orders into OrderGroups.`);
  await mongoose.disconnect();
  console.log('Done.');
}

migrate().catch((err) => {
  console.error('Migration failed with error:', err);
  mongoose.disconnect();
  process.exit(1);
});
