import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Body of `POST /predictions/ai-backfill`.
 *
 * This endpoint previously declared `@Body() body: { days?: number }`. The
 * global ValidationPipe skips non-class metatypes, so NOTHING validated it:
 * `{"days": 100000}` pulled a tenant's entire sales history into memory and
 * POSTed it as one JSON body (which the AI registry then rewrote to disk in
 * full), and `{"days": "abc"}` produced `Math.abs(NaN)` -> `"NaN-NaN-NaN"` ->
 * an Invalid Date in the Mongo filter -> a CastError 500.
 *
 * The cap mirrors QueryPredictionsDto's `@Max(100)` on `limit` and the
 * production plan's 14-day horizon: reject out-of-range input at the edge
 * rather than clamping silently.
 */
export class AiBackfillDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number = 120;
}
