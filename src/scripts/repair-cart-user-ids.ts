/**
 * One-shot repair for carts whose `userId` was stored as a string.
 *
 * `Cart.userId` was declared `@Prop({ type: Types.ObjectId })`, which
 * SchemaFactory resolves to Mixed — so nothing cast. CartService looks a cart
 * up by the raw string userId and, finding no match against the ObjectId
 * document, created a SECOND cart keyed by a string. From then on the customer
 * read and wrote the string document while `OrdersService.onPaid` emptied the
 * ObjectId one: paying never cleared the cart they could actually see.
 *
 * The schema is fixed, so the string documents are now unreachable — every
 * read casts to ObjectId. Their items are nonetheless the customer's REAL
 * cart, so they win over whatever sits in the ObjectId document (which is
 * stale by definition: nothing has written to it since the split).
 *
 * Idempotent: a second run finds no string-typed userId and does nothing.
 *
 *   npm run repair:cart-user-ids            # dry run, prints the plan
 *   npm run repair:cart-user-ids -- --apply # writes
 */
import * as dotenv from 'dotenv';
dotenv.config();

import mongoose, { Types } from 'mongoose';

async function repair(apply: boolean) {
  const carts = mongoose.connection.collection('carts');

  const broken = await carts.find({ userId: { $type: 'string' } }).toArray();
  console.log(`Found ${broken.length} cart(s) with a string userId`);

  let merged = 0;
  let converted = 0;

  for (const doc of broken) {
    const raw = doc.userId as unknown as string;
    if (!Types.ObjectId.isValid(raw)) {
      console.warn(`  cart ${String(doc._id)}: userId "${raw}" is not a valid ObjectId — skipped`);
      continue;
    }

    const userId = new Types.ObjectId(raw);
    const canonical = await carts.findOne({ userId });
    const items = doc.items ?? [];

    if (!canonical) {
      // Nothing to collide with: just fix the type in place.
      console.log(`  cart ${String(doc._id)}: convert userId to ObjectId (${items.length} item(s) kept)`);
      if (apply) {
        await carts.updateOne(
          { _id: doc._id },
          { $set: { userId, updatedAt: new Date() } },
        );
      }
      converted += 1;
      continue;
    }

    // Two documents for one customer. The string one is what they have been
    // using, so its items are authoritative; the ObjectId one is the shell
    // onPaid has been emptying.
    console.log(
      `  cart ${String(doc._id)}: merge ${items.length} item(s) into ${String(canonical._id)} ` +
        `(was ${(canonical.items ?? []).length}), then delete the duplicate`,
    );
    if (apply) {
      await carts.updateOne(
        { _id: canonical._id },
        { $set: { items, updatedAt: new Date() } },
      );
      await carts.deleteOne({ _id: doc._id });
    }
    merged += 1;
  }

  console.log(
    apply
      ? `Repaired: ${merged} merged, ${converted} converted`
      : `Dry run — would merge ${merged} and convert ${converted}. Re-run with --apply to write.`,
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
    await repair(apply);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Cart userId repair failed with error:', err);
    process.exit(1);
  });
}
