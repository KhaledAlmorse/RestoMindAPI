export interface GenerationOptions {
  modelId?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIProvider {
  readonly providerName: string;

  /**
   * Generate text completion using LLM or local template builder.
   */
  generateText(
    prompt: string,
    options?: GenerationOptions,
    messagesHistory?: ChatMessage[],
  ): Promise<string>;

  /**
   * Generate dense float vector embeddings.
   */
  generateEmbedding(
    text: string,
    inputType?: 'search_document' | 'search_query',
  ): Promise<number[]>;
}
