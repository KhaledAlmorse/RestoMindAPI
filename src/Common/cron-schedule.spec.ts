import 'reflect-metadata';
import { BUSINESS_TIMEZONE } from './Utils/date.util';
import { ProductionPlanningService } from '../production-planning/production-planning.service';
import { WeeklyPredictionService } from '../weekly-prediction/weekly-prediction.service';

/**
 * Every scheduled AI job in one place.
 *
 * The daily production-plan sync used to be `EVERY_DAY_AT_MIDNIGHT`
 * (`0 0 * * *`) and the weekly prediction batch is `0 0 * * 0` — they fired in
 * the same minute every Sunday. The FastAPI service is single-process and the
 * batch retry budget is 2 attempts at a 10s timeout, so that one night a week
 * the contention pushed products onto the naive fallback. The 03:00 accuracy
 * cron was staggered deliberately; this one never was.
 *
 * This suite is the guard: it asserts the whole schedule, and that every job
 * is interpreted in Cairo rather than the container's timezone. A bare
 * `CronExpression.*` constant carries no timezone of its own, so the explicit
 * option is load-bearing on all of them.
 */
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

function cronOf(target: any, method: string): { cronTime: string; timeZone?: string } {
  const meta = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, target.prototype[method]);
  if (!meta) throw new Error(`${method} is not decorated with @Cron`);
  return meta;
}

describe('AI cron schedule', () => {
  const jobs: Array<[string, any, string, string]> = [
    [
      'daily production plan generation',
      ProductionPlanningService,
      'handleDailyPlanGeneration',
      '0 1 * * *',
    ],
    [
      'nightly AI learning sync',
      ProductionPlanningService,
      'handleNightlyAiSync',
      '0 2 * * *',
    ],
    [
      'weekly prediction batch',
      WeeklyPredictionService,
      'handleWeeklyPredictionCron',
      '0 0 * * 0',
    ],
    [
      'weekly accuracy reconciliation',
      WeeklyPredictionService,
      'handleAccuracyReconciliationCron',
      '0 3 * * 0',
    ],
  ];

  it.each(jobs)(
    '%s runs on "%s" — schedule and timezone pinned',
    (_label, target, method, expression) => {
      const meta = cronOf(target, method);
      expect(meta.cronTime).toBe(expression);
      expect(meta.timeZone).toBe(BUSINESS_TIMEZONE);
    },
  );

  it('never schedules two AI jobs in the same minute on any day of the week', () => {
    // (dayOfWeek, hour, minute) triples each job actually fires at, expanded
    // over the week so a daily job is compared against every weekly one.
    const slots = new Map<string, string>();

    for (const [label, target, method] of jobs) {
      const { cronTime } = cronOf(target, method);
      const [minute, hour, , , dow] = cronTime.split(' ');
      const days = dow === '*' ? [0, 1, 2, 3, 4, 5, 6] : [Number(dow)];
      for (const day of days) {
        const key = `${day}:${hour}:${minute}`;
        const clash = slots.get(key);
        expect(clash).toBeUndefined();
        if (clash === undefined) slots.set(key, label as string);
      }
    }
  });

  it('keeps the daily production-plan sync clear of Sunday midnight', () => {
    const daily = cronOf(ProductionPlanningService, 'handleDailyPlanGeneration');
    const weekly = cronOf(WeeklyPredictionService, 'handleWeeklyPredictionCron');
    expect(daily.cronTime).not.toBe('0 0 * * *');
    expect(daily.cronTime.split(' ').slice(0, 2)).not.toEqual(
      weekly.cronTime.split(' ').slice(0, 2),
    );
  });
});
