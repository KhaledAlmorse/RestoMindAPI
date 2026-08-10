import { Connection } from 'mongoose';

/**
 * Atomically increments a named counter in the `counters` collection and
 * returns the new value. Mongo has no native auto-increment, so this
 * findOneAndUpdate($inc) is the standard substitute — a single small
 * document, safe under concurrent writers.
 */
export async function getNextSequence(
  connection: Connection,
  name: string,
): Promise<number> {
  const doc = await connection.collection('counters').findOneAndUpdate(
    { _id: name as any },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', includeResultMetadata: false },
  );

  return (doc as any).seq;
}
