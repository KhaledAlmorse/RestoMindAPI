import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { CategoryRepository, ProductRepository } from 'src/DB/Repositories';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { QueryCategoryDto } from './dto/query-category.dto';
import { isValidObjectId, Types } from 'mongoose';
import { UploadCloudFileService } from 'src/Common/Services';
import { CategoryType } from 'src/DB/Models';

@Injectable()
export class CategoriesService implements OnModuleInit {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly productRepository: ProductRepository,
    private readonly uploadCloudFileService: UploadCloudFileService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultCategoryExists();
  }

  async ensureDefaultCategoryExists(): Promise<CategoryType> {
    let defaultCategory = await this.categoryRepository.findOne({
      filters: { name: 'Default Category' },
    });
    if (defaultCategory) {
      if (defaultCategory.isDeleted) {
        defaultCategory = await this.categoryRepository.update({
          filters: { _id: defaultCategory._id },
          body: { isDeleted: false } as any,
        });
      }
    } else {
      defaultCategory = await this.categoryRepository.create({
        name: 'Default Category',
        description: 'Default category for products',
        image: {
          public_id: 'default-category-placeholder',
          secure_url: 'https://res.cloudinary.com/placeholder.jpg',
        },
        isDeleted: false,
      } as any);
    }
    return defaultCategory!;
  }

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  async createCategory(body: CreateCategoryDto, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Category image is required');
    }

    const { name } = body;
    const existing = await this.categoryRepository.findOne({
      filters: { name, isDeleted: false },
    });
    if (existing) {
      throw new ConflictException('Category with this name already exists');
    }

    const categoryId = new Types.ObjectId();
    const uploadResult = await this.uploadCloudFileService.uploadFile(
      file.path,
      {
        folder: `${process.env.CLOUD_FOLDER_NAME}/categories/${categoryId.toString()}`,
      },
    );

    const newCategory = await this.categoryRepository.create({
      _id: categoryId,
      ...body,
      image: uploadResult,
    });
    return { data: newCategory };
  }

  async updateCategory(
    id: string,
    body: UpdateCategoryDto,
    file?: Express.Multer.File,
  ) {
    this.validateObjectId(id);
    const category = await this.categoryRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    if (body.name) {
      const existing = await this.categoryRepository.findOne({
        filters: { name: body.name, isDeleted: false, _id: { $ne: id } },
      });
      if (existing) {
        throw new ConflictException('Category with this name already exists');
      }
    }

    const updateData: any = { ...body };

    if (file) {
      if (category.image && category.image.public_id) {
        await this.uploadCloudFileService.DeleteFileByPublicId(
          category.image.public_id,
        );
      }
      const uploadResult = await this.uploadCloudFileService.uploadFile(
        file.path,
        {
          folder: `${process.env.CLOUD_FOLDER_NAME}/categories/${id}`,
        },
      );
      updateData.image = uploadResult;
    }

    const updated = await this.categoryRepository.update({
      filters: { _id: id },
      body: updateData,
    });
    return { data: updated };
  }

  async deleteCategory(id: string) {
    this.validateObjectId(id);
    const category = await this.categoryRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    if (category.name === 'Default Category') {
      throw new BadRequestException('Default Category cannot be deleted');
    }

    if (category.image && category.image.public_id) {
      await this.uploadCloudFileService.DeleteFileByPublicId(
        category.image.public_id,
      );
    }

    // Ensure default category exists
    const defaultCategory = await this.ensureDefaultCategoryExists();

    // Reassign products of this category to the default category atomically
    await this.productRepository.updateMany(
      { category: new Types.ObjectId(id) },
      { category: defaultCategory._id },
    );

    await this.categoryRepository.update({
      filters: { _id: id },
      body: { isDeleted: true } as any,
    });
    return { message: 'Category deleted successfully' };
  }

  async getAllCategories(query?: QueryCategoryDto) {
    const { page, limit, search, isDeleted } = query || {};

    const filters: Record<string, any> = {};

    if (isDeleted !== undefined && isDeleted !== '') {
      filters.isDeleted = isDeleted === 'true' || (isDeleted as any) === true;
    } else {
      filters.isDeleted = false;
    }

    if (search !== undefined && search.trim() !== '') {
      filters.name = { $regex: search.trim(), $options: 'i' };
    }

    if (page || limit) {
      const pageNum = Math.max(1, parseInt(page || '1', 10));
      const limitNum = Math.max(1, parseInt(limit || '10', 10));
      const skip = (pageNum - 1) * limitNum;

      const result = await this.categoryRepository.findManyPaginated({
        filters,
        skip,
        limit: limitNum,
        sort: 'createdAt',
        order: 'desc',
      });

      return {
        data: result.items,
        items: result.items,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      };
    }

    const categories =
      (await this.categoryRepository.findMany({
        filters,
      })) || [];

    return {
      data: categories,
      items: categories,
      total: categories.length,
    };
  }

  async getCategoryById(id: string) {
    this.validateObjectId(id);
    const category = await this.categoryRepository.findOne({
      filters: { _id: id, isDeleted: false },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return { data: category };
  }
}
