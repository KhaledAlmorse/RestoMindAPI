import { Injectable, Logger } from '@nestjs/common';
import { AiClientService } from 'src/Common/Services/ai-client.service';

export interface IngestRecordPayload {
  date: string;
  productId: string;
  salesQty: number;
}

export interface IngestProductPayload {
  productId: string;
  title: string;
  category?: string;
}

export interface IngestPayload {
  restaurantId: string;
  records: IngestRecordPayload[];
  products: IngestProductPayload[];
}

export interface IngestResult {
  success: boolean;
  attempts: number;
  error?: string;
}

/**
 * Rows per request. A year of history across a full menu is tens of thousands
 * of rows, and the AI service rewrites its whole state store on each ingest —
 * so one giant request is both the slowest possible shape and the one whose
 * retry costs the most.
 */
export const INGEST_CHUNK_SIZE = 2000;

/**
 * Per-chunk timeout. The client's 10s default is sized for a single forecast
 * call; a bulk ingest legitimately takes longer, and timing out is not a
 * "service is down" signal here. Matches the backfill path in
 * weekly-prediction.service.ts, which already overrides to 60s.
 */
export const INGEST_TIMEOUT_MS = 60_000;

@Injectable()
export class AiIngestService {
  private readonly logger = new Logger(AiIngestService.name);

  constructor(private readonly aiClient: AiClientService) {}

  /**
   * Calls AI Microservice ingest endpoint through the shared client. If AI
   * microservice is unreachable or returns error, logs at ERROR level and
   * returns failure status without rolling back already written DB transactions.
   *
   * Records are sent in chunks. The AI registry de-duplicates on
   * (date, productId) keeping the last write, so a chunk that is retried — or
   * replayed later by POST /imports/:id/retry-ai-ingest — is idempotent. The
   * product list rides along with every chunk because the service needs it to
   * register products it has not seen before, whichever chunk arrives first.
   *
   * A failed chunk stops the run: the remaining rows would be no more likely to
   * land, and the job is marked AI_INGEST_FAILED so the retry endpoint replays
   * the whole set from the written transactions.
   */
  async ingest(payload: IngestPayload, maxRetries = 3): Promise<IngestResult> {
    // The AI service declares `records` with min_length=1, so an empty ingest
    // is a 422 — classified client_error and never retried. Every caller
    // already guards against this; treat it as a no-op rather than sending a
    // request the contract rejects.
    if (payload.records.length === 0) {
      return { success: true, attempts: 0 };
    }

    const chunks = this.chunk(payload.records, INGEST_CHUNK_SIZE);

    this.logger.log(
      `Triggering AI ingest for restaurant ${payload.restaurantId} ` +
        `(${payload.records.length} records in ${chunks.length} chunk(s))`,
    );

    for (let i = 0; i < chunks.length; i++) {
      const result = await this.aiClient.post(
        '/integration/restomind/ingest',
        {
          restaurantId: payload.restaurantId,
          records: chunks[i],
          products: payload.products,
        },
        { retries: maxRetries, timeoutMs: INGEST_TIMEOUT_MS },
      );

      if (!result.ok) {
        this.logger.error(
          `AI ingest failed for restaurant ${payload.restaurantId} ` +
            `on chunk ${i + 1}/${chunks.length}: ${result.message}`,
        );
        return {
          success: false,
          attempts: maxRetries,
          error: result.message,
        };
      }
    }

    return { success: true, attempts: 1 };
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      out.push(items.slice(i, i + size));
    }
    return out;
  }
}
