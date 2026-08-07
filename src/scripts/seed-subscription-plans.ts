/**
 * Seeds the three launch plans and backfills the subscription snapshots.
 *
 * Plans used to be a compiled constant (TIERS). They are now documents an
 * admin manages, so a database that predates this feature has none — every
 * merchant would resolve to zero capacity. This creates them at exactly the
 * prices that were previously hardcoded, so NO MERCHANT'S RENEWAL PRICE
 * MOVES as a result of running it.
 *
 * It also backfills the snapshots the new capacity check reads. Without them
 * effectiveProductCap() returns 0 for existing paying merchants — deliberately,
 * because an unset snapshot must never be guessed as "unlimited".
 *
 * Idempotent: an existing plan is never overwritten (an admin may have edited
 * it since), and a restaurant that already has a snapshot is skipped.
 *
 *   npm run seed:subscription-plans            # dry run, prints the plan
 *   npm run seed:subscription-plans -- --apply # writes
 */
import * as dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

/**
 * Prices in integer EGP cents, at the agreed ladder: half-yearly is 5.5x the
 * monthly price (half a month free) and yearly is 10x (two months free), so a
 * longer commitment always costs less per month.
 */
const PLANS = [
  {
    slug: 'basic',
    label: 'Basic',
    productCap: 1000,
    prices: { monthly: 30_000, halfYearly: 165_000, yearly: 300_000 },
    sortOrder: 0,
    archived: false,
    isTrialPlan: false,
  },
  {
    slug: 'plus',
    label: 'Plus',
    productCap: 3000,
    prices: { monthly: 60_000, halfYearly: 330_000, yearly: 600_000 },
    sortOrder: 1,
    archived: false,
    // Matches the retired TRIAL_TIER constant: a trial borrows Plus capacity.
    isTrialPlan: true,
  },
  {
    slug: 'scale',
    label: 'Scale',
    productCap: null, // unlimited
    prices: { monthly: 150_000, halfYearly: 825_000, yearly: 1_500_000 },
    sortOrder: 2,
    archived: false,
    isTrialPlan: false,
  },
];

const EARLY_BIRD_DISCOUNT_PERCENT = 33.3333;

async function seed(apply: boolean) {
  const plans = mongoose.connection.collection('subscriptionplans');
  const restaurants = mongoose.connection.collection('restaurants');
  const settings = mongoose.connection.collection('systemsettings');

  // --- 1. Plans -------------------------------------------------------------
  let created = 0;
  for (const plan of PLANS) {
    const existing = await plans.findOne({ slug: plan.slug });
    if (existing) {
      console.log(`  plan ${plan.slug}: already exists, left untouched`);
      continue;
    }
    console.log(
      `  plan ${plan.slug}: create — cap ${plan.productCap ?? 'unlimited'}, ` +
        `${plan.prices.monthly / 100}/${plan.prices.halfYearly / 100}/${plan.prices.yearly / 100} EGP`,
    );
    if (apply) {
      await plans.insertOne({
        ...plan,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    created += 1;
  }

  const capBySlug = new Map(PLANS.map((plan) => [plan.slug, plan]));
  const trialPlan = PLANS.find((plan) => plan.isTrialPlan)!;

  // --- 2. Paid snapshots ----------------------------------------------------
  const needSnapshot = await restaurants
    .find({
      'subscription.tier': { $exists: true, $ne: null },
      'subscription.productCapSnapshot': { $exists: false },
    })
    .toArray();

  console.log(`\n  ${needSnapshot.length} restaurant(s) need a paid snapshot`);
  let snapshotted = 0;
  for (const restaurant of needSnapshot) {
    const plan = capBySlug.get(restaurant.subscription?.tier);
    if (!plan) {
      console.warn(
        `    ${String(restaurant._id)}: unknown plan "${restaurant.subscription?.tier}" — skipped, set it by hand`,
      );
      continue;
    }
    if (apply) {
      await restaurants.updateOne(
        { _id: restaurant._id },
        {
          $set: {
            // Everything sold before this feature was billed monthly.
            'subscription.interval': 'monthly',
            'subscription.productCapSnapshot': plan.productCap,
            'subscription.planLabelSnapshot': plan.label,
          },
        },
      );
    }
    snapshotted += 1;
  }

  // --- 3. Trial caps --------------------------------------------------------
  const needTrialCap = await restaurants.countDocuments({
    'subscription.trialEndsAt': { $exists: true, $ne: null },
    'subscription.trialProductCap': { $exists: false },
  });
  console.log(`  ${needTrialCap} restaurant(s) need a trial cap`);
  if (apply && needTrialCap > 0) {
    await restaurants.updateMany(
      {
        'subscription.trialEndsAt': { $exists: true, $ne: null },
        'subscription.trialProductCap': { $exists: false },
      },
      { $set: { 'subscription.trialProductCap': trialPlan.productCap } },
    );
  }

  // --- 4. Early-bird discount rate -----------------------------------------
  const needDiscount = await settings.countDocuments({
    earlyBirdDiscountPercent: { $exists: false },
  });
  console.log(`  ${needDiscount} settings document(s) need the discount rate`);
  if (apply && needDiscount > 0) {
    await settings.updateMany(
      { earlyBirdDiscountPercent: { $exists: false } },
      { $set: { earlyBirdDiscountPercent: EARLY_BIRD_DISCOUNT_PERCENT } },
    );
  }

  console.log(
    apply
      ? `\nDone: ${created} plan(s) created, ${snapshotted} snapshot(s), ${needTrialCap} trial cap(s), ${needDiscount} setting(s)`
      : `\nDry run — would create ${created} plan(s), snapshot ${snapshotted} restaurant(s), set ${needTrialCap} trial cap(s) and ${needDiscount} setting(s). Re-run with --apply to write.`,
  );
}

async function run() {
  const dbUrl = process.env.DB_URL;
  if (!dbUrl) {
    console.error('DB_URL is not defined in environment variables.');
    process.exit(1);
  }

  const apply = process.argv.includes('--apply');
  await mongoose.connect(dbUrl);
  try {
    await seed(apply);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Plan seed failed with error:', err);
    process.exit(1);
  });
}
