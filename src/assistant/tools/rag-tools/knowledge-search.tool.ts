import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ToolRegistryService, ToolContext } from '../tool-registry.service';
import { VectorStoreService } from 'src/vector-store/vector-store.service';

const SearchKnowledgeSchema = z.object({
  query: z.string().min(2).describe('Search query in Egyptian Arabic or English'),
  entityTypes: z
    .array(z.enum(['product', 'recipe', 'offer', 'waste_report', 'recommendation', 'weekly_snapshot']))
    .optional(),
  limit: z.number().default(5),
});

@Injectable()
export class KnowledgeSearchTool implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly vectorStoreService: VectorStoreService,
  ) {}

  onModuleInit() {
    this.toolRegistry.registerTool({
      name: 'searchKnowledge',
      description: 'Executes Atlas Vector Search over embedded products, recipes, offers, waste reports, and recommendations.',
      schema: SearchKnowledgeSchema,
      requiresApproval: false,
      handler: (params, context) => this.searchKnowledge(params, context),
    });
  }

  async searchKnowledge(params: z.infer<typeof SearchKnowledgeSchema>, context: ToolContext) {
    const { query, entityTypes, limit } = params;
    const { restaurantId } = context;

    const results = await this.vectorStoreService.searchKnowledge(
      restaurantId,
      query,
      limit,
      entityTypes,
    );

    return {
      query,
      retrievedCount: results.length,
      matches: results.map((r) => ({
        entityType: r.entityType,
        entityId: r.entityId,
        textContent: r.textContent,
        metadata: r.metadata,
      })),
    };
  }
}
