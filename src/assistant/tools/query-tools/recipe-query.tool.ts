import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { z } from 'zod';
import { ToolRegistryService, ToolContext } from '../tool-registry.service';
import { ProductRepository } from 'src/DB/Repositories';
import { Recipe, RecipeType, Ingredient, IngredientType } from 'src/DB/Models';

const GetRecipeIngredientsSchema = z.object({
  productName: z.string().min(1).max(200).describe('Name or title of the product, recipe, or menu item'),
});

@Injectable()
export class RecipeQueryTool implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly productRepo: ProductRepository,
    @InjectModel(Recipe.name) private readonly recipeModel: Model<RecipeType>,
    @InjectModel(Ingredient.name) private readonly ingredientModel: Model<IngredientType>,
  ) {}

  onModuleInit() {
    this.toolRegistry.registerTool({
      name: 'getRecipeIngredients',
      description: 'Fetches structured recipe ingredients, exact quantities, and units for a product from the database.',
      schema: GetRecipeIngredientsSchema,
      requiresApproval: false,
      handler: (params, context) => this.getRecipeIngredients(params, context),
    });
  }

  async getRecipeIngredients(
    params: z.infer<typeof GetRecipeIngredientsSchema>,
    context: ToolContext,
  ) {
    const { productName } = params;
    const { restaurantId } = context;

    // 1. Search for Product by Title / Slug in Restaurant Context
    const products = (await this.productRepo.findMany({
      filters: {
        restaurantId,
        isDeleted: false,
        $or: [
          { title: { $regex: productName, $options: 'i' } },
          { slug: { $regex: productName, $options: 'i' } },
        ],
      } as any,
    })) || [];

    if (!products || products.length === 0) {
      return {
        productName,
        foundProduct: false,
        hasRecipe: false,
        ingredients: [],
      };
    }

    const matchedProduct = products[0];

    // 2. Fetch Recipe for Product
    const recipe = await this.recipeModel
      .findOne({
        restaurantId,
        productId: matchedProduct._id,
        isDeleted: false,
      })
      .lean();

    if (!recipe || !recipe.ingredients || recipe.ingredients.length === 0) {
      return {
        productName: matchedProduct.title,
        foundProduct: true,
        hasRecipe: false,
        ingredients: [],
      };
    }

    // 3. Fetch Ingredient Definitions
    const ingredientIds = recipe.ingredients.map((i: any) => i.ingredientId);
    const ingredientDocs = await this.ingredientModel
      .find({
        _id: { $in: ingredientIds },
        restaurantId,
        isDeleted: false,
      })
      .lean();

    const ingMap = new Map<string, any>();
    ingredientDocs.forEach((doc: any) => {
      ingMap.set(doc._id.toString(), doc);
    });

    const structuredIngredients = recipe.ingredients.map((ri: any) => {
      const ingDoc = ingMap.get(ri.ingredientId?.toString());
      return {
        name: ingDoc?.name || 'Unknown Ingredient',
        quantity: ri.quantityPerPortion !== undefined && ri.quantityPerPortion !== null ? ri.quantityPerPortion : null,
        unit: ri.unit || ingDoc?.unit || null,
      };
    });

    return {
      productName: matchedProduct.title,
      foundProduct: true,
      hasRecipe: true,
      ingredients: structuredIngredients,
    };
  }
}
