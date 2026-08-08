import { Injectable, Logger } from '@nestjs/common';
import { BaseService } from '../base.service';
import { KnowledgeVector, KnowledgeVectorType } from '../Models/knowledge-vector.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

export const KNOWLEDGE_VECTOR_INDEX = 'knowledge_vector_index';

export interface VectorSearchOutcome {
  matches: KnowledgeVectorType[];
  /**
   * False when Atlas `$vectorSearch` could not run at all. Callers MUST NOT
   * treat an empty result as "nothing matched" in that case — nothing was
   * ranked, so there is no similarity signal to draw a conclusion from.
   */
  vectorSearchUsed: boolean;
  reason?: string;
}

@Injectable()
export class KnowledgeVectorRepository extends BaseService<KnowledgeVectorType> {
  private readonly logger = new Logger(KnowledgeVectorRepository.name);

  constructor(
    @InjectModel(KnowledgeVector.name)
    private readonly knowledgeVectorModel: Model<KnowledgeVectorType>,
  ) {
    super(knowledgeVectorModel);
  }

  async vectorSearch(
    restaurantId: Types.ObjectId,
    queryVector: number[],
    limit = 10,
    entityTypes?: string[],
  ): Promise<VectorSearchOutcome> {
    const filter: Record<string, any> = {
      restaurantId: { $eq: restaurantId },
      isDeleted: { $eq: false },
    };

    if (entityTypes && entityTypes.length > 0) {
      filter.entityType = { $in: entityTypes };
    }

    // Atlas $vectorSearch aggregation pipeline stage. Every path referenced in
    // `filter` must also be declared as a `filter` field on the Atlas index
    // definition, or the whole stage errors.
    const pipeline: any[] = [
      {
        $vectorSearch: {
          index: KNOWLEDGE_VECTOR_INDEX,
          path: 'embedding',
          queryVector: queryVector,
          // Atlas recommends >= 20x limit for usable recall.
          numCandidates: Math.max(limit * 20, 100),
          limit: limit,
          filter: filter,
        },
      },
    ];

    try {
      const matches = await this.knowledgeVectorModel.aggregate(pipeline).exec();
      return { matches, vectorSearchUsed: true };
    } catch (error: any) {
      // This used to fall back to an unranked `.find().limit()` and return it
      // as if it were a similarity result, so a missing index produced
      // confident nonsense with no log line. Report the failure instead and
      // let the caller decide what a degraded answer looks like.
      const reason =
        error?.codeName === 'SearchNotEnabled'
          ? `Atlas Vector Search is not enabled on this deployment. $vectorSearch requires MongoDB Atlas or an Atlas CLI local deployment — it does not exist in MongoDB Community.`
          : `Atlas $vectorSearch failed on index [${KNOWLEDGE_VECTOR_INDEX}]: ${error?.message || error}`;

      this.logger.error(
        `${reason} — retrieval for restaurant [${restaurantId}] is DEGRADED (no semantic ranking).`,
      );

      return { matches: [], vectorSearchUsed: false, reason };
    }
  }
}
