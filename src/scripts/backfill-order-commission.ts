/**
 * Backfills commissionRate/commissionCents on orders created before the
 * snapshot existed, using each restaurant's current rate. Those orders predate
 * any commission agreement, so "current rate" is the only defensible value —
 * the alternative is leaving them at zero and under-charging silently.
 *
 * Idempotent: only touches orders where commissionCents is 0 or absent.
 * Orders created before this migration have no commissionCents field in
 * storage at all — Mongoose's schema `default: 0` only fills that in when a
 * document is hydrated, it is never written to the underlying document, so a
 * raw equality filter of `{ commissionCents: 0 }` silently matches none of
 * them. `$exists: false` is required to actually find the legacy rows.
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
      filters: {
        $or: [{ commissionCents: { $exists: false } }, { commissionCents: 0 }],
      },
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
