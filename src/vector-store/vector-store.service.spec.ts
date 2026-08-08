import { Types } from 'mongoose';
import { VectorStoreService } from './vector-store.service';
import { BedrockEmbeddingService } from './bedrock-embedding.service';
import { KnowledgeVectorRepository } from 'src/DB/Repositories';

/**
 * Guards the retrieval honesty rules. Every one of these used to be a silent
 * "success" that returned unranked or unrelated documents to the synthesiser.
 */
describe('VectorStoreService.searchKnowledge', () => {
  const restaurantId = new Types.ObjectId();
  const vector = new Array(1024).fill(0.01);

  function build(overrides: {
    vectorSearch?: jest.Mock;
    findMany?: jest.Mock;
    embed?: jest.Mock;
  }) {
    const knowledgeVectorRepo = {
      vectorSearch:
        overrides.vectorSearch ??
        jest.fn().mockResolvedValue({ matches: [], vectorSearchUsed: true }),
      findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
    } as unknown as KnowledgeVectorRepository;

    const embedding = {
      generateEmbedding: overrides.embed ?? jest.fn().mockResolvedValue(vector),
    } as unknown as BedrockEmbeddingService;

    const emptyRepo = { findMany: jest.fn().mockResolvedValue([]) } as any;

    const service = new VectorStoreService(
      knowledgeVectorRepo,
      embedding,
      emptyRepo, // product
      emptyRepo, // recipe
      emptyRepo, // offer
      emptyRepo, // wasteReport
      emptyRepo, // recommendation
      emptyRepo, // ingredient
    );

    return { service, knowledgeVectorRepo, emptyRepo };
  }

  it('reports an honest empty result when the index worked but nothing matched', async () => {
    const { service, emptyRepo } = build({});

    const result = await service.searchKnowledge(restaurantId, 'كرواسون بالزبدة');

    expect(result.matches).toEqual([]);
    expect(result.degraded).toBe(false);
    // The old code answered this case by returning the first N products in the
    // restaurant, which the synthesiser then labelled "related to your request".
    expect(emptyRepo.findMany).not.toHaveBeenCalled();
  });

  it('flags degraded and falls back to keywords when $vectorSearch is unavailable', async () => {
    const keywordHit = {
      entityType: 'product',
      entityId: new Types.ObjectId(),
      textContent: 'Product: Butter Croissant',
      metadata: { title: 'Butter Croissant' },
    };
    const { service } = build({
      vectorSearch: jest.fn().mockResolvedValue({
        matches: [],
        vectorSearchUsed: false,
        reason: 'Atlas Vector Search is not enabled on this deployment.',
      }),
      findMany: jest.fn().mockResolvedValue([keywordHit]),
    });

    const result = await service.searchKnowledge(restaurantId, 'croissant price');

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toContain('Atlas Vector Search');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].textContent).toBe('Product: Butter Croissant');
  });

  it('degrades rather than searching with a broken query vector when embedding fails', async () => {
    const vectorSearch = jest.fn();
    const { service } = build({
      vectorSearch,
      embed: jest.fn().mockRejectedValue(new Error('gateway 503')),
    });

    const result = await service.searchKnowledge(restaurantId, 'waste last week');

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toContain('gateway 503');
    // Critically: no search was attempted with a zero/garbage vector.
    expect(vectorSearch).not.toHaveBeenCalled();
  });

  it('does not build a regex from raw user input', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = build({
      vectorSearch: jest
        .fn()
        .mockResolvedValue({ matches: [], vectorSearchUsed: false, reason: 'no index' }),
      findMany,
    });

    // `(` alone is an invalid pattern; unescaped it throws inside RegExp.
    await expect(
      service.searchKnowledge(restaurantId, 'price of ((( croissant'),
    ).resolves.toBeDefined();

    const filters = findMany.mock.calls[0][0].filters;
    const patterns = filters.$or.map((c: any) => c.textContent.$regex.source);
    expect(patterns).toContain('croissant');
    expect(patterns).toContain('price');
    expect(patterns.some((p: string) => p.includes('('))).toBe(false);
  });

  it('returns nothing when the query has no usable tokens', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = build({
      vectorSearch: jest
        .fn()
        .mockResolvedValue({ matches: [], vectorSearchUsed: false, reason: 'no index' }),
      findMany,
    });

    const result = await service.searchKnowledge(restaurantId, '?? !');

    expect(result.matches).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('BedrockEmbeddingService', () => {
  it('throws instead of returning a zero vector when the provider fails', async () => {
    const service = new BedrockEmbeddingService({
      providerName: 'StubProvider',
      generateText: jest.fn(),
      generateEmbedding: jest.fn().mockRejectedValue(new Error('bedrock down')),
    } as any);

    // A stored zero vector poisons the index permanently; a zero query vector
    // ranks at random. Both previously looked like success.
    await expect(service.generateEmbedding('croissant')).rejects.toThrow('bedrock down');
  });
});
