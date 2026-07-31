import {
  correctedDeliveryDate,
  isUtcMidnight,
} from './migrate-ai-draft-delivery-dates';
import {
  addDaysToDateString,
  getBusinessDayRange,
} from '../Common/Utils/date.util';

/**
 * The migration rewrites `expectedDeliveryDate` on open AI draft POs from the
 * old UTC-midnight instant to the Cairo one. Two properties carry the whole
 * thing, and both are cheap to prove exhaustively:
 *
 *  1. The `targetWeek` string is recovered exactly from the legacy instant —
 *     get this wrong and a draft is re-dated to the wrong week entirely.
 *  2. A migrated value is never itself UTC midnight, which is what makes a
 *     second run a no-op instead of a corruption.
 */
describe('migrate-ai-draft-delivery-dates', () => {
  describe('isUtcMidnight', () => {
    it('is true only at exactly 00:00:00.000Z', () => {
      expect(isUtcMidnight(new Date('2026-07-27T00:00:00.000Z'))).toBe(true);
      expect(isUtcMidnight(new Date('2026-07-26T21:00:00.000Z'))).toBe(false);
      expect(isUtcMidnight(new Date('2026-01-25T22:00:00.000Z'))).toBe(false);
      // Near misses must not be swept up.
      expect(isUtcMidnight(new Date('2026-07-27T00:00:00.001Z'))).toBe(false);
      expect(isUtcMidnight(new Date('2026-07-27T00:00:01.000Z'))).toBe(false);
      expect(isUtcMidnight(new Date('2026-07-27T00:01:00.000Z'))).toBe(false);
    });
  });

  describe('correctedDeliveryDate', () => {
    it('maps a summer week to the Cairo day start (UTC+3)', () => {
      const { targetWeek, corrected } = correctedDeliveryDate(
        new Date('2026-07-27T00:00:00.000Z'),
      );
      expect(targetWeek).toBe('2026-07-27');
      expect(corrected.toISOString()).toBe('2026-07-26T21:00:00.000Z');
    });

    it('maps a winter week to the Cairo day start (UTC+2)', () => {
      const { targetWeek, corrected } = correctedDeliveryDate(
        new Date('2026-01-25T00:00:00.000Z'),
      );
      expect(targetWeek).toBe('2026-01-25');
      expect(corrected.toISOString()).toBe('2026-01-24T22:00:00.000Z');
    });

    it('recovers targetWeek exactly, and never produces a UTC midnight, across two years', () => {
      // Every Sunday for two years, so both Egypt DST transitions are crossed
      // in both directions.
      let week = '2025-01-05';
      const offsetsSeen = new Set<number>();

      for (let i = 0; i < 104; i++) {
        const legacy = new Date(`${week}T00:00:00.000Z`);
        const { targetWeek, corrected } = correctedDeliveryDate(legacy);

        // (1) round-trip
        expect(targetWeek).toBe(week);
        // and it agrees with what the service itself now computes
        expect(corrected).toEqual(getBusinessDayRange(week).start);

        // (2) idempotence: a second pass would skip this document
        expect(isUtcMidnight(corrected)).toBe(false);

        offsetsSeen.add((legacy.getTime() - corrected.getTime()) / 3_600_000);
        week = addDaysToDateString(week, 7);
      }

      // Only ever 2h (winter) or 3h (summer) — no other shift is possible, and
      // seeing both proves the sweep really crossed the DST boundaries.
      expect([...offsetsSeen].sort()).toEqual([2, 3]);
    });
  });
});
