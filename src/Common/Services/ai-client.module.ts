import { Global, Module } from '@nestjs/common';
import { AiClientService } from './ai-client.service';

/**
 * Global so the four consuming feature modules do not each have to import it.
 */
@Global()
@Module({
  providers: [AiClientService],
  exports: [AiClientService],
})
export class AiClientModule {}
