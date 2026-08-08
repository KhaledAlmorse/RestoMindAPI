import { Injectable, Logger, Inject } from '@nestjs/common';
import { AIProvider } from 'src/ai-provider/ai-provider.interface';
import { AI_PROVIDER } from 'src/ai-provider/ai-provider.module';

@Injectable()
export class BedrockEmbeddingService {
  private readonly logger = new Logger(BedrockEmbeddingService.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly aiProvider: AIProvider,
  ) {
    this.logger.log(`BedrockEmbeddingService initialized using Provider [${this.aiProvider.providerName}]`);
  }

  async generateEmbedding(
    text: string,
    inputType: 'search_document' | 'search_query' = 'search_document',
  ): Promise<number[]> {
    try {
      return await this.aiProvider.generateEmbedding(text, inputType);
    } catch (error: any) {
      // Previously this swallowed the failure and returned a 1024-zero vector.
      // Stored, that poisons the index permanently (a zero vector matches
      // nothing meaningfully); used as a query, it ranks results at random.
      // Both look like success. Fail instead and let callers degrade openly.
      this.logger.error(
        `Failed to generate embedding via Provider [${this.aiProvider.providerName}]: ${error?.message || error}`,
      );
      throw error;
    }
  }
}
