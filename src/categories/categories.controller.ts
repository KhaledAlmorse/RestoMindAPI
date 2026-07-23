import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Delete,
  Param,
  Query,
  Res,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { QueryCategoryDto } from './dto/query-category.dto';
import { type Response } from 'express';
import { Auth } from 'src/Common/Decorators';
import { FileInterceptor } from '@nestjs/platform-express';
import { uploadFileOptions } from 'src/Common/Utils/multer.utils';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @Auth('admin')
  @UseInterceptors(FileInterceptor('image', uploadFileOptions({})))
  async createCategory(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateCategoryDto,
    @Res() res: Response,
  ) {
    const result = await this.categoriesService.createCategory(body, file);
    res.status(HttpStatus.CREATED).json(result);
  }

  @Patch(':id')
  @Auth('admin')
  @UseInterceptors(FileInterceptor('image', uploadFileOptions({})))
  async updateCategory(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UpdateCategoryDto,
    @Res() res: Response,
  ) {
    const result = await this.categoriesService.updateCategory(id, body, file);
    res.status(HttpStatus.OK).json(result);
  }

  @Delete(':id')
  @Auth('admin')
  async deleteCategory(@Param('id') id: string, @Res() res: Response) {
    const result = await this.categoriesService.deleteCategory(id);
    res.status(HttpStatus.OK).json(result);
  }

  @Get()
  async getAllCategories(
    @Query() query: QueryCategoryDto,
    @Res() res: Response,
  ) {
    const result = await this.categoriesService.getAllCategories(query);
    res.status(HttpStatus.OK).json(result);
  }

  @Get(':id')
  async getCategoryById(@Param('id') id: string, @Res() res: Response) {
    const result = await this.categoriesService.getCategoryById(id);
    res.status(HttpStatus.OK).json(result);
  }
}
