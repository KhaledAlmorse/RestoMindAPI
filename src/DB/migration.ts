import * as dotenv from 'dotenv';
dotenv.config();

import mongoose, { Schema } from 'mongoose';

async function run() {
  const dbUrl = process.env.DB_URL;
  if (!dbUrl) {
    console.error('DB_URL is not defined in environment variables.');
    process.exit(1);
  }

  console.log('Connecting to database...');
  await mongoose.connect(dbUrl);
  console.log('Connected to database.');

  // Define minimal schemas for migration
  const UserSchema = new Schema({}, { strict: false });
  const RestaurantSchema = new Schema(
    {
      name: String,
      ownerUserId: mongoose.Schema.Types.ObjectId,
      isActive: Boolean,
      isDeleted: Boolean,
    },
    { strict: false },
  );
  const ProductSchema = new Schema(
    {
      title: String,
      restaurantId: mongoose.Schema.Types.ObjectId,
    },
    { strict: false },
  );

  const User = mongoose.model('User', UserSchema, 'users');
  const Restaurant = mongoose.model(
    'Restaurant',
    RestaurantSchema,
    'restaurants',
  );
  const Product = mongoose.model('Product', ProductSchema, 'products');

  // Find a manager or admin user or any user to own the restaurant
  let owner: any = await User.findOne({ role: 'manager' });
  if (!owner) {
    owner = await User.findOne({ role: 'admin' });
  }
  if (!owner) {
    owner = await User.findOne({});
  }

  if (!owner) {
    console.error('No users found in database to set as restaurant owner.');
    process.exit(1);
  }

  console.log(`Using owner user: ${owner._id} (${owner.get('email')})`);

  // Check if default restaurant already exists
  let defaultRest: any = await Restaurant.findOne({
    name: 'Default Restaurant',
  });
  if (!defaultRest) {
    console.log('Creating default restaurant...');
    defaultRest = await Restaurant.create({
      name: 'Default Restaurant',
      ownerUserId: owner._id,
      description: 'Default restaurant for existing products',
      isActive: true,
      isDeleted: false,
    } as any);
    console.log(`Default restaurant created with ID: ${defaultRest._id}`);
  } else {
    console.log(
      `Using existing default restaurant with ID: ${defaultRest._id}`,
    );
  }

  // Update products that do not have a restaurantId
  const result = await Product.updateMany(
    { restaurantId: { $exists: false } },
    { $set: { restaurantId: defaultRest._id } },
  );

  console.log(
    `Products migration finished. Matched/Modified: ${result.matchedCount}/${result.modifiedCount}`,
  );

  // Update the owner user's restaurantId if they don't have one
  if (!owner.get('restaurantId')) {
    await User.updateOne(
      { _id: owner._id },
      { $set: { restaurantId: defaultRest._id } },
    );
    console.log(`Assigned Default Restaurant ID to user ${owner._id}`);
  }

  await mongoose.disconnect();
  console.log('Database disconnected.');
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
