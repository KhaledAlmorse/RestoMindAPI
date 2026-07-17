import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CategoryRepository } from 'src/DB/Repositories';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { isValidObjectId, Types } from 'mongoose';
import { UploadCloudFileService } from 'src/Common/Services';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly uploadCloudFileService: UploadCloudFileService,
  ) {}

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

    if (category.image && category.image.public_id) {
      await this.uploadCloudFileService.DeleteFileByPublicId(
        category.image.public_id,
      );
    }

    await this.categoryRepository.update({
      filters: { _id: id },
      body: { isDeleted: true } as any,
    });
    return { message: 'Category deleted successfully' };
  }

  async getAllCategories() {
    const categories = await this.categoryRepository.findMany({
      filters: { isDeleted: false },
    });
    return { data: categories };
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
