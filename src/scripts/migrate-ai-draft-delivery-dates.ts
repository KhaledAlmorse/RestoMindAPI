/**
 * One-off migration: move AI draft purchase orders off UTC-midnight
 * `expectedDeliveryDate` values and onto the Cairo instant for the same week.
 *
 * WHY THIS EXISTS
 * ---------------
 * `supplier-auto-draft` used to compute its week start as
 * `new Date(\`${targetWeek}T00:00:00.000Z\`)` — a UTC midnight built from what
 * is actually a *Cairo* calendar date, so the instant was 2–3h off the day it
 * named. That value is written to `expectedDeliveryDate`, and it is also one of
 * the six clauses of the draft-PO idempotency filter:
 *
 *     { restaurantId, supplierId, status: DRAFT, source: AI_FORECAST,
 *       expectedDeliveryDate: targetWeekStart, isDeleted: false }
 *
 * Idempotency itself was never broken — the read bound and the written value
 * came from the same expression, so they always agreed. But now that the
 * expression yields the Cairo instant (`...T21:00:00.000Z` in summer,
 * `...T22:00:00.000Z` in winter), drafts written by the OLD code can never be
 * matched again. Without this migration the first run after deploy creates a
 * second draft per supplier per already-drafted open week, and the old one is
 * ORPHANED rather than superseded: it freezes at its last-written `items` while
 * the new draft keeps updating, and nothing distinguishes which is current.
 * There is no unique index on the dedup tuple, so the duplicate inserts
 * silently and never surfaces at runtime. A stale draft that someone sends is a
 * double order.
 *
 * SAFETY
 * ------
 * - Dry run by default. Pass `--apply` to actually write.
 * - Idempotent: it only ever touches documents whose `expectedDeliveryDate` is
 *   EXACTLY UTC midnight. A Cairo day start is 21:00Z or 22:00Z and can never
 *   be 00:00Z, so an already-migrated document is invisible to this script.
 * - Scoped to `source: ai_forecast`, `status: draft`, `isDeleted: false`.
 *   Sent/received POs and manually created drafts are never touched.
 * - If migrating a document would collide with an existing correctly-dated
 *   draft for the same (restaurant, supplier, week), it is REPORTED and SKIPPED
 *   rather than merged — deciding which `items` survive is a human call.
 *
 * This is deliberately NOT wired into any startup path, module, or cron.
 * Running it is a deploy-time decision.
 *
 *   npx ts-node src/scripts/migrate-ai-draft-delivery-dates.ts            # dry run
 *   npx ts-node src/scripts/migrate-ai-draft-delivery-dates.ts --apply    # write
 */
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';

import { getBusinessDayRange } from '../Common/Utils/date.util';

dotenv.config();

const APPLY = process.argv.includes('--apply');

/**
 * True only for an instant that is exactly 00:00:00.000 UTC.
 *
 * This is the migration's idempotence guarantee: a Cairo day start is 21:00Z
 * (summer) or 22:00Z (winter) and can never be 00:00Z, so a document that has
 * already been migrated is invisible to a second run.
 */
export function isUtcMidnight(date: Date): boolean {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

/**
 * The Cairo instant a legacy UTC-midnight `expectedDeliveryDate` should become.
 *
 * The old expression was `new Date(\`${targetWeek}T00:00:00.000Z\`)`, so the UTC
 * date portion recovers the exact `targetWeek` string it was built from — which
 * is then re-derived through the same helper the service now uses.
 */
export function correctedDeliveryDate(current: Date): {
  targetWeek: string;
  corrected: Date;
} {
  const targetWeek = current.toISOString().slice(0, 10);
  return { targetWeek, corrected: getBusinessDayRange(targetWeek).start };
}

async function migrate() {
  const DB_URL = process.env.DB_URL;
  if (!DB_URL) {
    console.error('DB_URL is not defined in environment variables.');
    process.exit(1);
  }

  console.log(
    APPLY
      ? 'Running in APPLY mode — documents will be modified.'
      : 'Running in DRY RUN mode — nothing will be written. Pass --apply to commit.',
  );

  await mongoose.connect(DB_URL as string);
  const db = mongoose.connection.db;
  if (!db) {
    console.error('Database connection failed.');
    process.exit(1);
  }

  const purchaseOrders = db.collection('purchaseorders');

  const candidates = await purchaseOrders
    .find({
      source: 'ai_forecast',
      status: 'draft',
      isDeleted: false,
      expectedDeliveryDate: { $ne: null },
    })
    .toArray();

  console.log(`Scanned ${candidates.length} open AI draft purchase orders.`);

  let migrated = 0;
  let alreadyCorrect = 0;
  let conflicts = 0;

  for (const po of candidates) {
    const current: Date = new Date(po.expectedDeliveryDate);

    if (!isUtcMidnight(current)) {
      alreadyCorrect++;
      continue;
    }

    const { targetWeek, corrected } = correctedDeliveryDate(current);

    // Would this collide with a draft the NEW code already created for the same
    // supplier and week? If so the two are duplicates and merging them is a
    // human decision — report and skip.
    const twin = await purchaseOrders.findOne({
      _id: { $ne: po._id },
      restaurantId: po.restaurantId,
      supplierId: po.supplierId,
      status: 'draft',
      source: 'ai_forecast',
      expectedDeliveryDate: corrected,
      isDeleted: false,
    });

    if (twin) {
      conflicts++;
      console.warn(
        `  CONFLICT  po ${po._id.toString()} (week ${targetWeek}, supplier ` +
          `${po.supplierId?.toString()}) would collide with existing draft ` +
          `${twin._id.toString()}. Skipped — resolve manually.`,
      );
      continue;
    }

    console.log(
      `  ${APPLY ? 'MIGRATE ' : 'WOULD MIGRATE'} po ${po._id.toString()} ` +
        `week ${targetWeek}: ${current.toISOString()} -> ${corrected.toISOString()}`,
    );

    if (APPLY) {
      await purchaseOrders.updateOne(
        { _id: po._id },
        { $set: { expectedDeliveryDate: corrected } },
      );
    }
    migrated++;
  }

  console.log('');
  console.log(`  ${APPLY ? 'Migrated' : 'Would migrate'}: ${migrated}`);
  console.log(`  Already on a Cairo instant (untouched): ${alreadyCorrect}`);
  console.log(`  Conflicts skipped: ${conflicts}`);
  if (conflicts > 0) {
    console.log('');
    console.log(
      'Conflicts mean a duplicate draft already exists for that supplier and week.',
    );
    console.log(
      'Decide which items are current, delete the other, then re-run this script.',
    );
  }
  if (!APPLY && migrated > 0) {
    console.log('');
    console.log('Dry run only. Re-run with --apply to commit these changes.');
  }

  await mongoose.disconnect();
  console.log('Done.');
}

// Only when run directly. The date helpers above are exported and unit-tested,
// and importing this file must never open a database connection.
if (require.main === module) {
  migrate().catch((err) => {
    console.error('Migration failed with error:', err);
    mongoose.disconnect();
    process.exit(1);
  });
}
