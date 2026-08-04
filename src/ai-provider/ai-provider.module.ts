import { Module, Global, Logger } from '@nestjs/common';
import { BedrockProvider } from './providers/bedrock.provider';
import { GatewayProvider } from './providers/gateway.provider';
import { LocalProvider } from './providers/local.provider';
import { AIProvider } from './ai-provider.interface';

export const AI_PROVIDER = 'AI_PROVIDER';

@Global()
@Module({
  providers: [
    BedrockProvider,
    GatewayProvider,
    LocalProvider,
    {
      provide: AI_PROVIDER,
      useFactory: (): AIProvider => {
        const logger = new Logger('AIProviderFactory');
        const providerType = (process.env.AI_PROVIDER_TYPE || '').toLowerCase().trim();
        const scholarshipKey = (
          process.env.SCHOLARSHIP_API_KEY ||
          process.env.BEDROCK_GATEWAY_KEY ||
          process.env.AWS_SECRET_ACCESS_KEY ||
          process.env.AWS_ACCESS_KEY_ID ||
          ''
        ).trim();
        const gatewayUrl = (process.env.BEDROCK_GATEWAY_URL || '').trim();

        // 1. Explicit Provider Type Overrides
        if (providerType === 'gateway') {
          return new GatewayProvider();
        } else if (providerType === 'bedrock') {
          return new BedrockProvider();
        } else if (providerType === 'local') {
          return new LocalProvider();
        }

        // 2. Auto-Detection based on Scholarship Key & Gateway Configuration
        if (scholarshipKey.startsWith('sbg_') || gatewayUrl || scholarshipKey.length > 0) {
          logger.log('Auto-detected GatewayProvider for Scholarship Proxy Key');
          return new GatewayProvider();
        }

        logger.log('Auto-detected LocalProvider (No scholarship key or gateway configured)');
        return new LocalProvider();
      },
    },
  ],
  exports: [AI_PROVIDER, BedrockProvider, GatewayProvider, LocalProvider],
})
export class AIProviderModule {}
