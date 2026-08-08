import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ToolRegistryService, ToolContext } from '../tool-registry.service';
import { VectorStoreService } from 'src/vector-store/vector-store.service';

const SearchKnowledgeSchema = z.object({
  query: z.string().min(2).max(500).describe('Search query in Egyptian Arabic or English'),
  entityTypes: z
    .array(z.enum(['product', 'recipe', 'offer', 'waste_report', 'recommendation', 'weekly_snapshot']))
    .optional(),
  limit: z.number().min(1).max(10).default(5),
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
      matches: results.map((r) => {
        const safeMetadata = { ...(r.metadata || {}) };
        delete safeMetadata.restaurantId;
        delete safeMetadata.entityId;
        delete safeMetadata._id;
        delete safeMetadata.__v;

        return {
          entityType: r.entityType,
          textContent: r.textContent,
          ...(Object.keys(safeMetadata).length > 0 ? { metadata: safeMetadata } : {}),
        };
      }),
    };
  }
}
