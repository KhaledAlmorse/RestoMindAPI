import { Injectable, Logger } from '@nestjs/common';

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

@Injectable()
export class AiIngestService {
  private readonly logger = new Logger(AiIngestService.name);

  /**
   * Calls AI Microservice ingest endpoint with 3 retries and exponential backoff.
   * If AI microservice is unreachable or returns error, logs at ERROR level and
   * returns failure status without rolling back already written DB transactions.
   */
  async ingest(
    payload: IngestPayload,
    maxRetries = 3,
    initialBackoffMs = 2000,
  ): Promise<IngestResult> {
    const aiBaseUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8200';
    const ingestUrl = `${aiBaseUrl.replace(/\/$/, '')}/integration/restomind/ingest`;

    let lastError = '';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(
          `[Attempt ${attempt}/${maxRetries}] Triggering AI ingest for restaurant ${payload.restaurantId} (${payload.records.length} records)`,
        );

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout per call

        const response = await fetch(ingestUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          this.logger.log(
            `AI Ingest succeeded on attempt ${attempt} for restaurant ${payload.restaurantId}`,
          );
          return { success: true, attempts: attempt };
        }

        const errorText = await response
          .text()
          .catch(() => 'Unknown HTTP error');
        lastError = `HTTP ${response.status}: ${errorText}`;
        this.logger.warn(
          `[Attempt ${attempt}/${maxRetries}] AI Ingest failed with status ${response.status}: ${errorText}`,
        );
      } catch (err: any) {
        lastError = err?.message || 'Network error or timeout';
        this.logger.warn(
          `[Attempt ${attempt}/${maxRetries}] AI Ingest error: ${lastError}`,
        );
      }

      if (attempt < maxRetries) {
        const backoffMs = initialBackoffMs * Math.pow(4, attempt - 1); // 2s, 8s, 32s
        this.logger.log(`Backing off for ${backoffMs}ms before retry...`);
        await this.delay(backoffMs);
      }
    }

    this.logger.error(
      `AI Ingest exhausted all ${maxRetries} retries for restaurant ${payload.restaurantId}. Last error: ${lastError}`,
    );

    return {
      success: false,
      attempts: maxRetries,
      error: lastError,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
