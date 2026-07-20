import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ProductRepository,
  CategoryRepository,
  RestaurantRepository,
  OfferRepository,
} from 'src/DB/Repositories';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { isValidObjectId, Types } from 'mongoose';
import { UploadCloudFileService } from 'src/Common/Services';
import slugify from 'slugify';
import { OfferStatusEnum, OfferSourceEnum } from 'src/Common/Types';
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
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  async createProduct(body: CreateProductDto, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Product image is required');
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

    this.validateObjectId(body.restaurantId);
    const restaurant = await this.restaurantRepository.findOne({
      filters: { _id: body.restaurantId, isDeleted: false },
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
      restaurantId: new Types.ObjectId(body.restaurantId),
      image: uploadResult,
    } as any);
    return { data: newProduct };
  }

  async updateProduct(
    id: string,
    body: UpdateProductDto,
    file?: Express.Multer.File,
  ) {
    this.validateObjectId(id);
    const product = await this.productRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
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

    const finalPrice =
      updateBody.price !== undefined ? updateBody.price : product.price;
    const finalDiscountedPrice =
      updateBody.discountedPrice !== undefined
        ? updateBody.discountedPrice
        : product.discountedPrice;
    if (finalDiscountedPrice > finalPrice) {
      throw new BadRequestException(
        'Discounted price cannot be greater than the original price',
      );
    }
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

    if (body.price !== undefined) {
      await this.offersService.syncProductDiscountedPrice(id);
    }

    return { data: updated };
  }

  async deleteProduct(id: string) {
    this.validateObjectId(id);
    const product = await this.productRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
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
    return { message: 'Product deleted successfully' };
  }

  async changeAvailability(id: string, isAvailable?: boolean) {
    this.validateObjectId(id);
    const product = await this.productRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
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

  async updateDiscount(
    id: string,
    discountedPrice?: number,
    endDate?: string,
    userId?: string,
  ) {
    this.validateObjectId(id);
    const product = await this.productRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (discountedPrice === undefined) {
      return { data: product };
    }

    if (discountedPrice < 0) {
      throw new BadRequestException('Discount price cannot be negative');
    }

    if (discountedPrice > product.price) {
      throw new BadRequestException(
        'Discounted price cannot be greater than the original price',
      );
    }

    if (!userId) {
      throw new BadRequestException('User ID is required to update discount');
    }

    const existingOverlap = await this.offerRepository.findOne({
      filters: {
        productId: new Types.ObjectId(id),
        status: { $in: [OfferStatusEnum.ACTIVE, OfferStatusEnum.SCHEDULED] },
        isDeleted: false,
      },
    });
    if (existingOverlap) {
      throw new ConflictException(
        'This product already has an active or scheduled offer',
      );
    }

    const discountPercentage = Math.round(
      (1 - discountedPrice / product.price) * 100,
    );

    const now = new Date();
    const defaultEndDate = new Date(now);
    defaultEndDate.setDate(defaultEndDate.getDate() + 7);

    await this.offerRepository.create({
      productId: new Types.ObjectId(id),
      restaurantId: product.restaurantId,
      discountPercentage,
      startDate: now,
      endDate: endDate ? new Date(endDate) : defaultEndDate,
      status: OfferStatusEnum.ACTIVE,
      source: OfferSourceEnum.MANUAL,
      featured: false,
      createdBy: new Types.ObjectId(userId),
    } as any);

    await this.offersService.syncProductDiscountedPrice(id);

    const updated = await this.productRepository.findOne({
      filters: { _id: id },
    });
    return { data: updated };
  }

  async getAllProducts(query: QueryProductDto) {
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

    // Filters: non-deleted and available
    const filters: Record<string, any> = {
      isDeleted: false,
      isAvailable: true,
    };

    if (category) {
      this.validateObjectId(category);
      filters['category'] = new Types.ObjectId(category);
    }

    if (restaurantId) {
      this.validateObjectId(restaurantId);
      filters['restaurantId'] = new Types.ObjectId(restaurantId);
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

  async getRecommendations(query: { page?: string; limit?: string }) {
    const { page = '1', limit = '10' } = query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const skip = (pageNum - 1) * limitNum;

    const now = new Date();
    const activeOffers = await this.offerRepository.findMany({
      filters: {
        status: OfferStatusEnum.ACTIVE,
        isDeleted: false,
        startDate: { $lte: now },
        endDate: { $gte: now },
      },
    });

    activeOffers.sort((a: any, b: any) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    const candidateProductIds = activeOffers.map((o) => o.productId);

    let validProducts: any[] = [];
    if (candidateProductIds.length > 0) {
      validProducts =
        (await this.productRepository.findMany({
          filters: {
            _id: { $in: candidateProductIds },
            isDeleted: false,
            isAvailable: true,
          },
          populationArray: [{ path: 'category' }],
        })) || [];
    }

    const productMap = new Map(
      validProducts.map((p: any) => [p._id.toString(), p]),
    );
    const orderedProducts = candidateProductIds
      .map((id) => productMap.get(id.toString()))
      .filter(Boolean);

    const total = orderedProducts.length;
    const items = orderedProducts.slice(skip, skip + limitNum);

    return {
      items,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  async getProductDetails(idOrSlug: string) {
    let product;
    if (isValidObjectId(idOrSlug)) {
      product = await this.productRepository.findOne({
        filters: { _id: idOrSlug, isDeleted: false, isAvailable: true },
        populationArray: [{ path: 'category' }],
      });
    } else {
      product = await this.productRepository.findOne({
        filters: { slug: idOrSlug, isDeleted: false, isAvailable: true },
        populationArray: [{ path: 'category' }],
      });
    }
    if (!product) {
      throw new NotFoundException('Product not found or unavailable');
    }
    return { data: product };
  }
}
