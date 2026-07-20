import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Recipe, RecipeType } from '../Models/recipe.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class RecipeRepository extends BaseService<RecipeType> {
  constructor(
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeType>,
  ) {
    super(recipeModel);
  }

  async findMany(options: {
    filters?: Record<string, any>;
    populationArray?: any[];
  }) {
    const { filters = {}, populationArray = [] } = options;
    const query = this.recipeModel.find(filters);
    for (const pop of populationArray) {
      query.populate(pop);
    }
    return query.exec();
  }
}
