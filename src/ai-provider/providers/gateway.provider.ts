import { Injectable, Logger } from '@nestjs/common';
import {
  AIProvider,
  GenerationOptions,
  ChatMessage,
} from '../ai-provider.interface';

@Injectable()
export class GatewayProvider implements AIProvider {
  readonly providerName = 'GatewayProvider';
  private readonly logger = new Logger(GatewayProvider.name);
  private readonly apiKey: string;
  private readonly gatewayUrl: string;
  private readonly primaryLlm =
    process.env.BEDROCK_PRIMARY_LLM || 'anthropic.claude-sonnet-4-6';
  private readonly embeddingModel =
    process.env.BEDROCK_PRIMARY_EMBEDDING || 'us.cohere.embed-v4:0';

  constructor() {
    this.apiKey = (
      process.env.SCHOLARSHIP_API_KEY ||
      process.env.SBG_API_KEY ||
      process.env.BEDROCK_GATEWAY_KEY ||
      ''
    ).trim();

    this.gatewayUrl = (process.env.BEDROCK_GATEWAY_URL || '').replace(/\/$/, '');

    this.logger.log(
      `Initialized Scholarship GatewayProvider (Base URL: ${this.gatewayUrl || '/api/v1'}, Key set: ${this.apiKey ? 'YES' : 'NO'})`,
    );

    // This provider authenticates with a bearer/api-key header. AWS's own
    // endpoints only accept SigV4 (`Authorization: AWS4-HMAC-SHA256
    // Credential=…, SignedHeaders=…, Signature=…`), which this provider cannot
    // produce — so every call 403s with "Authorization header requires
    // 'Credential' parameter". Warn loudly if BEDROCK_GATEWAY_URL is
    // misconfigured to point at AWS directly.
    if (
      this.gatewayUrl &&
      /(^|\.)amazonaws\.com$/i.test(new URL(this.gatewayUrl).hostname)
    ) {
      this.logger.error(
        `MISCONFIGURED: GatewayProvider is pointed at an AWS endpoint (${this.gatewayUrl}) but signs requests with a bearer key, which AWS always rejects (HTTP 403, SigV4 required). ` +
        `Set BEDROCK_GATEWAY_URL to your scholarship gateway domain, or set AI_PROVIDER_TYPE=bedrock to use the AWS SDK with real IAM credentials instead. ` +
        `Until then every LLM and embedding call fails and the assistant answers in degraded mode.`,
      );
    }

    if (!this.apiKey) {
      this.logger.error(
        'MISCONFIGURED: GatewayProvider has no API key (checked SCHOLARSHIP_API_KEY, BEDROCK_GATEWAY_KEY, AWS_SECRET_ACCESS_KEY, AWS_ACCESS_KEY_ID).',
      );
    }
  }

  private buildUrl(endpoint: string): string {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const baseUrl = this.gatewayUrl || 'http://apiaccess.iti.net.eg';
    const base = baseUrl.endsWith('/api/v1')
      ? baseUrl
      : `${baseUrl}/api/v1`;
    return `${base}${cleanEndpoint}`;
  }

  async generateText(
    prompt: string,
    options?: GenerationOptions,
    messagesHistory: ChatMessage[] = [],
  ): Promise<string> {
    const modelId = options?.modelId || this.primaryLlm;
    const systemPrompt = options?.systemPrompt || '';
    const url = this.buildUrl('/student/chat');

    const messages =
      messagesHistory.length > 0
        ? messagesHistory.map((m) => ({ role: m.role, content: m.content }))
        : [{ role: 'user', content: prompt }];

    const payload = {
      model_id: modelId,
      messages,
      system_prompt: systemPrompt,
      max_tokens: options?.maxTokens || 1500,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const responseBody = await response.json();
      if (typeof responseBody === 'string') return responseBody;
      return (
        responseBody.output_text ||
        responseBody.response ||
        responseBody.completion ||
        responseBody.text ||
        responseBody.content?.[0]?.text ||
        (typeof responseBody.content === 'string' ? responseBody.content : null) ||
        responseBody.choices?.[0]?.message?.content ||
        JSON.stringify(responseBody)
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

    try {
      const url = this.buildUrl('/student/embed');
      const payload = {
        model_id: this.embeddingModel,
        texts: [text.trim()],
        input_type: inputType,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const responseBody = await response.json();
        if (Array.isArray(responseBody.embedding)) {
          return responseBody.embedding;
        }
        if (Array.isArray(responseBody.embeddings)) {
          return Array.isArray(responseBody.embeddings[0])
            ? responseBody.embeddings[0]
            : responseBody.embeddings;
        }
        if (responseBody.embeddings?.float) {
          return Array.isArray(responseBody.embeddings.float[0])
            ? responseBody.embeddings.float[0]
            : responseBody.embeddings.float;
        }
        if (responseBody.data?.[0]?.embedding) {
          return responseBody.data[0].embedding;
        }
      }

      const errText = await response.text();
      this.logger.warn(`Scholarship Gateway embedding HTTP ${response.status}: ${errText}`);
      return new Array(1024).fill(0);
    } catch (error: any) {
      this.logger.warn(`Scholarship Gateway embedding fallback: ${error?.message || error}`);
      return new Array(1024).fill(0);
    }
  }
}
