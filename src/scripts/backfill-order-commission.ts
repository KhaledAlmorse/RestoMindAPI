/**
 * Backfills commissionRate/commissionCents on orders created before the
 * snapshot existed, using each restaurant's current rate. Those orders predate
 * any commission agreement, so "current rate" is the only defensible value —
 * the alternative is leaving them at zero and under-charging silently.
 *
 * Idempotent: only touches orders where commissionCents is absent from
 * storage entirely. Orders created before this migration have no
 * commissionCents field in the stored document — Mongoose's schema
 * `default: 0` only fills that in at hydration time, never on disk — so
 * `$exists: false` alone finds every legacy row.
 *
 * Deliberately NOT `{ commissionCents: 0 }`: every order created after this
 * deploy writes commissionRate/commissionCents explicitly, so a restaurant
 * with a genuine 0% rate produces real, correctly-snapshotted orders with
 * commissionCents === 0. Matching on that value would re-touch them on every
 * run and overwrite them with whatever the restaurant's rate happens to be
 * *now* if it's ever changed later — the exact silent rewrite this snapshot
 * exists to prevent.
 *
 *   npm run backfill:order-commission
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../app.module';
import { OrderRepository, RestaurantRepository } from 'src/DB/Repositories';
import {
  commissionCentsFor,
  commissionRateFor,
} from 'src/payouts/payout.config';

async function backfill(app: INestApplicationContext) {
  const orderRepository = app.get(OrderRepository);
  const restaurantRepository = app.get(RestaurantRepository);

  const restaurants = (await restaurantRepository.findMany({})) ?? [];
  const rateByRestaurant = new Map<string, number>(
    restaurants.map((r) => [String(r._id), commissionRateFor(r as any)]),
  );

  const orders =
    (await orderRepository.findMany({
      filters: { commissionCents: { $exists: false } },
    })) ?? [];

  let updated = 0;
  for (const order of orders) {
    const rate = rateByRestaurant.get(String(order.restaurantId));
    if (rate === undefined) {
      console.warn(`Order ${String(order._id)}: restaurant not found, skipped`);
      continue;
    }
    const grossCents = Math.round((order.finalTotalPrice ?? 0) * 100);
    await orderRepository.update({
      filters: { _id: order._id },
      body: {
        commissionRate: rate,
        commissionCents: commissionCentsFor(grossCents, rate),
      } as any,
    });
    updated += 1;
  }

  console.log(`Backfilled ${updated} of ${orders.length} orders`);
}

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    await backfill(app);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Backfill failed with error:', err);
    process.exit(1);
  });
}
