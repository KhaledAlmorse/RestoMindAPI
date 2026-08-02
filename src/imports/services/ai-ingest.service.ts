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

@Injectable()
export class AiIngestService {
  private readonly logger = new Logger(AiIngestService.name);

  constructor(private readonly aiClient: AiClientService) {}

  /**
   * Calls AI Microservice ingest endpoint through the shared client. If AI
   * microservice is unreachable or returns error, logs at ERROR level and
   * returns failure status without rolling back already written DB transactions.
   */
  async ingest(payload: IngestPayload, maxRetries = 3): Promise<IngestResult> {
    this.logger.log(
      `Triggering AI ingest for restaurant ${payload.restaurantId} (${payload.records.length} records)`,
    );

    const result = await this.aiClient.post(
      '/integration/restomind/ingest',
      payload,
      { retries: maxRetries },
    );

    if (result.ok) {
      return { success: true, attempts: 1 };
    }

    this.logger.error(
      `AI ingest failed for restaurant ${payload.restaurantId}: ${result.message}`,
    );
    return { success: false, attempts: maxRetries, error: result.message };
  }
}
