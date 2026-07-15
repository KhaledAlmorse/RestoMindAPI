import { Model, QueryFilter, PopulateOptions, Document } from 'mongoose';

interface findOneOptions<TDocument> {
  filters: QueryFilter<TDocument>;
  select?: string;
  populationArray?: PopulateOptions[];
}
interface findManyOptions<TDocument> {
  filters?: QueryFilter<TDocument>;
  select?: string;
  populationArray?: PopulateOptions[];
}

interface updateOptions<TDocument> {
  filters: QueryFilter<TDocument>;
  body: Partial<TDocument>;
}

interface deleteOptions<TDocument> {
  filters: QueryFilter<TDocument>;
}

interface deleteManyOptions<TDocument> {
  filters: QueryFilter<TDocument>;
}

export abstract class BaseService<TDocument extends Document> {
  constructor(private readonly model: Model<TDocument>) {}

  async save(newDocument: TDocument) {
    return await newDocument.save();
  }

  async create(document: Partial<TDocument>): Promise<TDocument> {
    return await this.model.create(document);
  }

  async findOne(options: findOneOptions<TDocument>): Promise<TDocument | null> {
    if (options.filters._id) {
      return await this.model
        .findById(options.filters._id)
        .select(options.select ?? '')
        .populate(options.populationArray ?? [])
        .exec();
    }
    return await this.model
      .findOne(options.filters)
      .select(options.select ?? '')
      .populate(options.populationArray ?? [])
      .exec();
  }

  async findMany(
    options: findManyOptions<TDocument>,
  ): Promise<TDocument[] | null> {
    return await this.model
      .find(options.filters ?? {})
      .select(options.select ?? '')
      .populate(options.populationArray ?? [])
      .exec();
  }

  async update(options: updateOptions<TDocument>): Promise<TDocument | null> {
    if (options.filters._id) {
      return await this.model
        .findByIdAndUpdate(options.filters._id, options.body, { new: true })
        .exec();
    }
    return await this.model
      .findOneAndUpdate(options.filters, options.body, { new: true })
      .exec();
  }

  async delete(options: deleteOptions<TDocument>): Promise<TDocument | null> {
    if (options.filters._id) {
      return await this.model.findByIdAndDelete(options.filters._id).exec();
    }
    return await this.model.findOneAndDelete(options.filters).exec();
  }
  async deleteMany(options: deleteManyOptions<TDocument>) {
    return this.model.deleteMany(options.filters);
  }
}
