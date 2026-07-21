import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ProductRepository,
  CategoryRepository,
  RestaurantRepository,
  OfferRepository,
  RecipeRepository,
  IngredientRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { UpsertRecipeDto } from './dto/upsert-recipe.dto';
import { isValidObjectId, Types } from 'mongoose';
import { UploadCloudFileService } from 'src/Common/Services';
import slugify from 'slugify';
import { RolesEnum } from 'src/Common/Types';
import type { IAuthUser } from 'src/Common/Types';
import { OffersService } from 'src/offers/offers.service';

@Injectable()
export class ProductsService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly uploadCloudFileService: UploadCloudFileService,
    private readonly offerRepository: OfferRepository,
    private readonly offersService: OffersService,
    private readonly recipeRepository: RecipeRepository,
    private readonly ingredientRepository: IngredientRepository,
    private readonly userRepository: UserRepository,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  private async getManagerRestaurantId(
    userId: string,
  ): Promise<Types.ObjectId> {
    this.validateObjectId(userId);
    const user = await this.userRepository.findOne({
      filters: { _id: new Types.ObjectId(userId), isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.restaurantId) {
      return new Types.ObjectId(user.restaurantId.toString());
    }

    const restaurant = await this.restaurantRepository.findOne({
      filters: { ownerUserId: new Types.ObjectId(userId), isDeleted: false },
    });

    if (!restaurant) {
      throw new ForbiddenException(
        'You are not assigned to a restaurant or do not own one',
      );
    }

    return restaurant._id;
  }

  async createProduct(
    body: CreateProductDto,
    authUser: IAuthUser,
    file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Product image is required');
    }

    let targetRestaurantId: Types.ObjectId;

    if (authUser.user.role === RolesEnum.MANAGER) {
      targetRestaurantId = await this.getManagerRestaurantId(
        authUser.user._id.toString(),
      );
      if (
        body.restaurantId &&
        body.restaurantId !== targetRestaurantId.toString()
      ) {
        throw new ForbiddenException(
          'You can only create products for your own restaurant',
        );
      }
    } else {
      if (!body.restaurantId) {
        throw new BadRequestException(
          'restaurantId is required when creating a product as admin',
        );
      }
      this.validateObjectId(body.restaurantId);
      targetRestaurantId = new Types.ObjectId(body.restaurantId);
    }

    const price = body.price;
    const discountedPrice =
      body.discountedPrice !== undefined ? body.discountedPrice : price;
    if (discountedPrice > price) {
      throw new BadRequestException(
        'Discounted price cannot be greater than the original price',
      );
    }

    this.validateObjectId(body.category);
    const category = await this.categoryRepository.findOne({
      filters: { _id: body.category, isDeleted: false },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const restaurant = await this.restaurantRepository.findOne({
      filters: { _id: targetRestaurantId, isDeleted: false },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    // Generate unique slug: restaurant-name + "-" + product-title
    const restaurantNameSlug = slugify(restaurant.name, {
      lower: true,
      strict: true,
    });
    const productTitleSlug = slugify(body.title, { lower: true, strict: true });
    const slug = `${restaurantNameSlug}-${productTitleSlug}`;

    const existingSlug = await this.productRepository.findOne({
      filters: { slug, isDeleted: false },
    });
    if (existingSlug) {
      throw new ConflictException(
        'Product with this title already exists in this restaurant',
      );
    }

    const productId = new Types.ObjectId();
    const uploadResult = await this.uploadCloudFileService.uploadFile(
      file.path,
      {
        folder: `${process.env.CLOUD_FOLDER_NAME}/products/${productId.toString()}`,
      },
    );

    const newProduct = await this.productRepository.create({
      ...body,
      _id: productId,
      discountedPrice,
      slug,
      category: new Types.ObjectId(body.category),
      restaurantId: targetRestaurantId,
      image: uploadResult,
    } as any);
    return { data: newProduct };
  }

  async updateProduct(
    id: string,
    body: UpdateProductDto,
    authUser: IAuthUser,
    file?: Express.Multer.File,
  ) {
    this.validateObjectId(id);
    const product = await this.productRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (authUser.user.role === RolesEnum.MANAGER) {
      const managerRestaurantId = await this.getManagerRestaurantId(
        authUser.user._id.toString(),
      );
      if (product.restaurantId.toString() !== managerRestaurantId.toString()) {
        throw new ForbiddenException(
          'You can only update products belonging to your own restaurant',
        );
      }
      if (
        body.restaurantId &&
        body.restaurantId !== managerRestaurantId.toString()
      ) {
        throw new ForbiddenException(
          'You cannot reassign products to another restaurant',
        );
      }
    }

    const updateBody: any = { ...body };
    let slug = product.slug;

    if (body.category) {
      this.validateObjectId(body.category);
      const category = await this.categoryRepository.findOne({
        filters: { _id: body.category, isDeleted: false },
      });
      if (!category) {
        throw new NotFoundException('Category not found');
      }
      updateBody.category = new Types.ObjectId(body.category);
    }

    if (body.restaurantId) {
      this.validateObjectId(body.restaurantId);
      const restaurant = await this.restaurantRepository.findOne({
        filters: { _id: body.restaurantId, isDeleted: false },
      });
      if (!restaurant) {
        throw new NotFoundException('Restaurant not found');
      }
      updateBody.restaurantId = new Types.ObjectId(body.restaurantId);
    }

    if (body.title || body.restaurantId) {
      const restId = body.restaurantId || product.restaurantId.toString();
      const restaurant = await this.restaurantRepository.findOne({
        filters: { _id: restId, isDeleted: false },
      });
      if (!restaurant) {
        throw new NotFoundException('Restaurant not found');
      }
      const title = body.title || product.title;
      const restaurantNameSlug = slugify(restaurant.name, {
        lower: true,
        strict: true,
      });
      const productTitleSlug = slugify(title, { lower: true, strict: true });
      slug = `${restaurantNameSlug}-${productTitleSlug}`;

      const existingSlug = await this.productRepository.findOne({
        filters: { slug, isDeleted: false, _id: { $ne: id } },
      });
      if (existingSlug) {
        throw new ConflictException(
          'Product with this title already exists in this restaurant',
        );
      }
    }
    updateBody.slug = slug;

    if (file) {
      if (product.image && product.image.public_id) {
        await this.uploadCloudFileService.DeleteFileByPublicId(
          product.image.public_id,
        );
      }
      const uploadResult = await this.uploadCloudFileService.uploadFile(
        file.path,
        {
          folder: `${process.env.CLOUD_FOLDER_NAME}/products/${id}`,
        },
      );
      updateBody.image = uploadResult;
    }

    const updated = await this.productRepository.update({
      filters: { _id: id },
      body: updateBody,
    });

    return { data: updated };
  }

  async deleteProduct(id: string, authUser: IAuthUser) {
    this.validateObjectId(id);
    const product = await this.productRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (authUser.user.role === RolesEnum.MANAGER) {
      const managerRestaurantId = await this.getManagerRestaurantId(
        authUser.user._id.toString(),
      );
      if (product.restaurantId.toString() !== managerRestaurantId.toString()) {
        throw new ForbiddenException(
          'You can only delete products belonging to your own restaurant',
        );
      }
    }

    if (product.image && product.image.public_id) {
      await this.uploadCloudFileService.DeleteFileByPublicId(
        product.image.public_id,
      );
    }

    await this.productRepository.update({
      filters: { _id: id },
      body: { isDeleted: true },
    });

    await this.recipeRepository.update({
      filters: { productId: new Types.ObjectId(id), isDeleted: false },
      body: { isDeleted: true, deletedAt: new Date() } as any,
    });

    return { message: 'Product deleted successfully' };
  }

  async changeAvailability(
    id: string,
    isAvailable: boolean | undefined,
    authUser: IAuthUser,
  ) {
    this.validateObjectId(id);
    const product = await this.productRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (authUser.user.role === RolesEnum.MANAGER) {
      const managerRestaurantId = await this.getManagerRestaurantId(
        authUser.user._id.toString(),
      );
      if (product.restaurantId.toString() !== managerRestaurantId.toString()) {
        throw new ForbiddenException(
          'You can only modify products belonging to your own restaurant',
        );
      }
    }

    if (isAvailable === undefined) {
      return { data: product };
    }

    const updated = await this.productRepository.update({
      filters: { _id: id },
      body: { isAvailable } as any,
    });
    return { data: updated };
  }

  async getAllProducts(query: QueryProductDto, authUser?: IAuthUser) {
    const {
      page = '1',
      limit = '10',
      category,
      search,
      tag,
      sort = 'createdAt',
      order = 'desc',
      restaurantId,
    } = query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const skip = (pageNum - 1) * limitNum;

    const filters: Record<string, any> = {
      isDeleted: false,
    };

    if (authUser?.user?.role === RolesEnum.MANAGER) {
      const managerRestaurantId = await this.getManagerRestaurantId(
        authUser.user._id.toString(),
      );
      filters['restaurantId'] = managerRestaurantId;
    } else if (authUser?.user?.role === RolesEnum.CUSTOMER) {
      filters['isAvailable'] = true;
      if (restaurantId) {
        this.validateObjectId(restaurantId);
        filters['restaurantId'] = new Types.ObjectId(restaurantId);
      }
    } else {
      // Admin or public
      if (restaurantId) {
        this.validateObjectId(restaurantId);
        filters['restaurantId'] = new Types.ObjectId(restaurantId);
      }
    }

    if (category) {
      this.validateObjectId(category);
      filters['category'] = new Types.ObjectId(category);
    }

    if (search) {
      filters['title'] = { $regex: search, $options: 'i' };
    }

    if (tag) {
      filters['tags'] = tag;
    }

    const result = await this.productRepository.findManyPaginated({
      filters,
      skip,
      limit: limitNum,
      sort,
      order,
      populationArray: ['category', 'restaurantId'],
    });

    return result;
  }

  async getProductDetails(idOrSlug: string, authUser?: IAuthUser) {
    let product: any;
    if (isValidObjectId(idOrSlug)) {
      product = await this.productRepository.findOne({
        filters: { _id: idOrSlug, isDeleted: false },
        populationArray: [{ path: 'category' }, { path: 'restaurantId' }],
      });
    } else {
      product = await this.productRepository.findOne({
        filters: { slug: idOrSlug, isDeleted: false },
        populationArray: [{ path: 'category' }, { path: 'restaurantId' }],
      });
    }
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (authUser?.user?.role === RolesEnum.MANAGER) {
      const managerRestaurantId = await this.getManagerRestaurantId(
        authUser.user._id.toString(),
      );
      const restIdStr = product.restaurantId._id
        ? product.restaurantId._id.toString()
        : product.restaurantId.toString();

      if (restIdStr !== managerRestaurantId.toString()) {
        throw new ForbiddenException(
          'You can only view product details for your own restaurant',
        );
      }
    }

    return { data: product };
  }

  async upsertRecipe(idOrSlug: string, dto: UpsertRecipeDto, userId: string) {
    const managerRestaurantId = await this.getManagerRestaurantId(userId);

    let product: any;
    if (isValidObjectId(idOrSlug)) {
      product = await this.productRepository.findOne({
        filters: { _id: new Types.ObjectId(idOrSlug), isDeleted: false },
      });
    } else {
      product = await this.productRepository.findOne({
        filters: { slug: idOrSlug, isDeleted: false },
      });
    }

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.restaurantId.toString() !== managerRestaurantId.toString()) {
      throw new ForbiddenException(
        'You can only manage recipes for products in your own restaurant',
      );
    }

    const ingredientIds = dto.ingredients.map((item) => item.ingredientId);
    const uniqueIds = new Set(ingredientIds);
    if (uniqueIds.size !== ingredientIds.length) {
      throw new BadRequestException(
        'Recipe ingredients list contains duplicate ingredient entries',
      );
    }

    const recipeIngredients: any[] = [];
    for (const item of dto.ingredients) {
      this.validateObjectId(item.ingredientId);
      const ingredient = await this.ingredientRepository.findOne({
        filters: {
          _id: new Types.ObjectId(item.ingredientId),
          isDeleted: false,
        },
      });

      if (!ingredient) {
        throw new NotFoundException(
          `Ingredient with ID ${item.ingredientId} not found`,
        );
      }

      if (
        ingredient.restaurantId.toString() !== product.restaurantId.toString()
      ) {
        throw new BadRequestException(
          `Ingredient with ID ${item.ingredientId} belongs to a different restaurant`,
        );
      }

      if (item.unit !== ingredient.unit) {
        throw new BadRequestException(
          `Unit mismatch for ingredient '${ingredient.name}'. Expected '${ingredient.unit}', got '${item.unit}'`,
        );
      }

      recipeIngredients.push({
        ingredientId: new Types.ObjectId(item.ingredientId),
        quantityPerPortion: item.quantityPerPortion,
        unit: item.unit,
        yieldPercentage: item.yieldPercentage ?? 100,
      });
    }

    const existingRecipe = await this.recipeRepository.findOne({
      filters: { productId: product._id, isDeleted: false },
    });

    let recipe;
    if (existingRecipe) {
      recipe = await this.recipeRepository.update({
        filters: { _id: existingRecipe._id },
        body: { ingredients: recipeIngredients } as any,
      });
    } else {
      recipe = await this.recipeRepository.create({
        restaurantId: product.restaurantId,
        productId: product._id,
        ingredients: recipeIngredients,
      } as any);
    }

    return { data: recipe };
  }

  async getRecipe(idOrSlug: string, userId: string) {
    const managerRestaurantId = await this.getManagerRestaurantId(userId);

    let product: any;
    if (isValidObjectId(idOrSlug)) {
      product = await this.productRepository.findOne({
        filters: { _id: new Types.ObjectId(idOrSlug), isDeleted: false },
      });
    } else {
      product = await this.productRepository.findOne({
        filters: { slug: idOrSlug, isDeleted: false },
      });
    }

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.restaurantId.toString() !== managerRestaurantId.toString()) {
      throw new ForbiddenException(
        'You can only view recipes for products in your own restaurant',
      );
    }

    const recipe: any = await this.recipeRepository.findOne({
      filters: { productId: product._id, isDeleted: false },
      populationArray: [{ path: 'ingredients.ingredientId' }],
    });

    if (!recipe) {
      throw new NotFoundException('Recipe not found for this product');
    }

    if (recipe.ingredients) {
      recipe.ingredients = recipe.ingredients.filter(
        (item: any) => item.ingredientId && !item.ingredientId.isDeleted,
      );
    }

    return { data: recipe };
  }
}
