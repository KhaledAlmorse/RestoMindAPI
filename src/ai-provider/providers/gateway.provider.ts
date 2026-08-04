import { Injectable, Logger } from '@nestjs/common';
import { AIProvider, GenerationOptions, ChatMessage } from '../ai-provider.interface';

@Injectable()
export class GatewayProvider implements AIProvider {
  readonly providerName = 'GatewayProvider';
  private readonly logger = new Logger(GatewayProvider.name);
  private readonly apiKey: string;
  private readonly gatewayUrl: string;
  private readonly primaryLlm = process.env.BEDROCK_PRIMARY_LLM || 'anthropic.claude-sonnet-4-6';
  private readonly embeddingModel = process.env.BEDROCK_PRIMARY_EMBEDDING || 'us.cohere.embed-v4:0';

  constructor() {
    this.apiKey = (
      process.env.SCHOLARSHIP_API_KEY ||
      process.env.BEDROCK_GATEWAY_KEY ||
      process.env.AWS_SECRET_ACCESS_KEY ||
      process.env.AWS_ACCESS_KEY_ID ||
      ''
    ).trim();

    this.gatewayUrl = (
      process.env.BEDROCK_GATEWAY_URL || 'https://bedrock-runtime.us-east-1.amazonaws.com'
    ).replace(/\/$/, '');

    this.logger.log(
      `Initialized Scholarship GatewayProvider (URL: ${this.gatewayUrl}, Key set: ${this.apiKey ? 'YES' : 'NO'})`,
    );
  }

  async generateText(
    prompt: string,
    options?: GenerationOptions,
    messagesHistory: ChatMessage[] = [],
  ): Promise<string> {
    const modelId = options?.modelId || this.primaryLlm;
    const systemPrompt = options?.systemPrompt || '';
    const url = `${this.gatewayUrl}/model/${modelId}/invoke`;

    const messages =
      messagesHistory.length > 0
        ? messagesHistory.map((m) => ({ role: m.role, content: m.content }))
        : [{ role: 'user', content: prompt }];

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: options?.maxTokens || 1500,
      temperature: options?.temperature ?? 0.7,
      system: systemPrompt,
      messages,
    };

    const authHeader = this.apiKey.startsWith('sbg_') ? this.apiKey : `Bearer ${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        'x-api-key': this.apiKey,
        'api-key': this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const responseBody = await response.json();
      return (
        responseBody.content?.[0]?.text ||
        responseBody.choices?.[0]?.message?.content ||
        ''
      );
    }

    const errText = await response.text();
    this.logger.warn(`Scholarship Gateway HTTP ${response.status}: ${errText}`);
    throw new Error(`Scholarship Gateway HTTP ${response.status}: ${errText}`);
  }

  async generateEmbedding(
    text: string,
    inputType: 'search_document' | 'search_query' = 'search_document',
  ): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      return new Array(1024).fill(0);
    }

    const url = `${this.gatewayUrl}/model/${this.embeddingModel}/invoke`;
    const payload = {
      texts: [text.trim()],
      input_type: inputType,
      truncate: 'END',
    };

    const authHeader = this.apiKey.startsWith('sbg_') ? this.apiKey : `Bearer ${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        'x-api-key': this.apiKey,
        'api-key': this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const responseBody = await response.json();
      if (responseBody.embeddings && responseBody.embeddings.float) {
        return responseBody.embeddings.float[0];
      } else if (Array.isArray(responseBody.embeddings)) {
        return responseBody.embeddings[0];
      } else if (responseBody.data?.[0]?.embedding) {
        return responseBody.data[0].embedding;
      }
    }

    const errText = await response.text();
    this.logger.warn(`Scholarship Gateway embedding HTTP ${response.status}: ${errText}`);
    throw new Error(`Scholarship Gateway embedding HTTP ${response.status}: ${errText}`);
  }
}
