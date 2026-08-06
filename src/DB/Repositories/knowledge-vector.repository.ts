import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { KnowledgeVector, KnowledgeVectorType } from '../Models/knowledge-vector.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

@Injectable()
export class KnowledgeVectorRepository extends BaseService<KnowledgeVectorType> {
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
  ): Promise<KnowledgeVectorType[]> {
    const filter: Record<string, any> = {
      restaurantId: { $eq: restaurantId },
      isDeleted: { $eq: false },
    };

    if (entityTypes && entityTypes.length > 0) {
      filter.entityType = { $in: entityTypes };
    }

    // Atlas $vectorSearch aggregation pipeline stage
    const pipeline: any[] = [
      {
        $vectorSearch: {
          index: 'knowledge_vector_index',
          path: 'embedding',
          queryVector: queryVector,
          numCandidates: limit * 10,
          limit: limit,
          filter: filter,
        },
      },
    ];

    try {
      return await this.knowledgeVectorModel.aggregate(pipeline).exec();
    } catch (error) {
      // Fallback for local testing or environments where Atlas Search index is not yet built
      return await this.knowledgeVectorModel
        .find({ restaurantId, isDeleted: false, ...(entityTypes?.length ? { entityType: { $in: entityTypes } } : {}) })
        .limit(limit)
        .exec();
    }
  }
}
