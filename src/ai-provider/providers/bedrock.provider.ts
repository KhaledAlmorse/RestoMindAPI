import { Injectable, Logger } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { AIProvider, GenerationOptions, ChatMessage } from '../ai-provider.interface';

@Injectable()
export class BedrockProvider implements AIProvider {
  readonly providerName = 'BedrockProvider';
  private readonly logger = new Logger(BedrockProvider.name);
  private readonly bedrockClient: BedrockRuntimeClient;
  private readonly primaryLlm = process.env.BEDROCK_PRIMARY_LLM || 'anthropic.claude-sonnet-4-6';
  private readonly embeddingModel = process.env.BEDROCK_PRIMARY_EMBEDDING || 'us.cohere.embed-v4:0';

  constructor() {
    const region = process.env.AWS_REGION || 'us-east-1';
    const accessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
    const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();

    this.bedrockClient = new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
    this.logger.log(`Initialized BedrockProvider via AWS SDK (${region})`);
  }

  async generateText(
    prompt: string,
    options?: GenerationOptions,
    messagesHistory: ChatMessage[] = [],
  ): Promise<string> {
    const modelId = options?.modelId || this.primaryLlm;
    const systemPrompt = options?.systemPrompt || '';

    const messages = messagesHistory.length > 0
      ? messagesHistory.map((m) => ({ role: m.role, content: m.content }))
      : [{ role: 'user', content: prompt }];

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: options?.maxTokens || 1500,
      temperature: options?.temperature ?? 0.7,
      system: systemPrompt,
      messages,
    };

    try {
      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      return (
        responseBody.content?.[0]?.text ||
        responseBody.choices?.[0]?.message?.content ||
        ''
      );
    } catch (error: any) {
      this.logger.error(`Bedrock SDK generateText failed [${modelId}]: ${error?.message || error}`);
      throw error;
    }
  }

  async generateEmbedding(
    text: string,
    inputType: 'search_document' | 'search_query' = 'search_document',
  ): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      return new Array(1024).fill(0);
    }

    const payload = {
      texts: [text.trim()],
      input_type: inputType,
      truncate: 'END',
    };

    try {
      const command = new InvokeModelCommand({
        modelId: this.embeddingModel,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      if (responseBody.embeddings && responseBody.embeddings.float) {
        return responseBody.embeddings.float[0];
      } else if (Array.isArray(responseBody.embeddings)) {
        return responseBody.embeddings[0];
      }

      return new Array(1024).fill(0);
    } catch (error: any) {
      this.logger.error(`Bedrock SDK generateEmbedding failed: ${error?.message || error}`);
      throw error;
    }
  }
}
