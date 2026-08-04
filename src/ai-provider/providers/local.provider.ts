import { Injectable, Logger } from '@nestjs/common';
import { AIProvider, GenerationOptions, ChatMessage } from '../ai-provider.interface';

@Injectable()
export class LocalProvider implements AIProvider {
  readonly providerName = 'LocalProvider';
  private readonly logger = new Logger(LocalProvider.name);

  constructor() {
    this.logger.log('Initialized Standalone LocalProvider for offline development (0 network calls)');
  }

  async generateText(
    prompt: string,
    options?: GenerationOptions,
    messagesHistory: ChatMessage[] = [],
  ): Promise<string> {
    // In local mode, throw an intent fallback signal or return empty string so Planner and Assistant use clean grounded templates
    return '';
  }

  async generateEmbedding(
    text: string,
    inputType: 'search_document' | 'search_query' = 'search_document',
  ): Promise<number[]> {
    return this.createDeterministicFallbackEmbedding(text, 1024);
  }

  private createDeterministicFallbackEmbedding(
    text: string,
    dimensions: number,
  ): number[] {
    const vector = new Array(dimensions).fill(0);
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const index = (charCode * (i + 1)) % dimensions;
      vector[index] = (vector[index] + charCode / 255) / 2;
    }
    const magnitude = Math.sqrt(
      vector.reduce((sum, val) => sum + val * val, 0),
    );
    return magnitude > 0 ? vector.map((v) => v / magnitude) : vector;
  }
}
