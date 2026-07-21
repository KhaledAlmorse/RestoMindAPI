import {
  Controller,
  Get,
  Post,
  Put,
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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { UpdateProductAvailabilityDto } from './dto/update-product-availability.dto';
import { UpsertRecipeDto } from './dto/upsert-recipe.dto';

import { type Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import type { IAuthUser } from 'src/Common/Types';
import { FileInterceptor } from '@nestjs/platform-express';
import { uploadFileOptions } from 'src/Common/Utils/multer.utils';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Auth('admin', 'manager')
  @UseInterceptors(FileInterceptor('image', uploadFileOptions({})))
  async createProduct(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateProductDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.productsService.createProduct(
      body,
      authUser,
      file,
    );
    res.status(HttpStatus.CREATED).json(result);
  }

  @Patch(':id')
  @Auth('admin', 'manager')
  @UseInterceptors(FileInterceptor('image', uploadFileOptions({})))
  async updateProduct(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UpdateProductDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.productsService.updateProduct(
      id,
      body,
      authUser,
      file,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Delete(':id')
  @Auth('admin', 'manager')
  async deleteProduct(
    @Param('id') id: string,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.productsService.deleteProduct(id, authUser);
    res.status(HttpStatus.OK).json(result);
  }

  @Patch(':id/availability')
  @Auth('admin', 'manager')
  async changeAvailability(
    @Param('id') id: string,
    @Body() body: UpdateProductAvailabilityDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.productsService.changeAvailability(
      id,
      body.isAvailable,
      authUser,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get()
  @Auth('admin', 'manager')
  async getAllProducts(
    @Query() query: QueryProductDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.productsService.getAllProducts(query, authUser);
    res.status(HttpStatus.OK).json(result);
  }

  @Get(':id')
  @Auth('admin', 'manager')
  async getProductDetails(
    @Param('id') id: string,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.productsService.getProductDetails(id, authUser);
    res.status(HttpStatus.OK).json(result);
  }

  @Put(':productId/recipe')
  @Auth('manager')
  async upsertRecipe(
    @Param('productId') productId: string,
    @Body() body: UpsertRecipeDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.productsService.upsertRecipe(
      productId,
      body,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get(':productId/recipe')
  @Auth('manager')
  async getRecipe(
    @Param('productId') productId: string,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.productsService.getRecipe(
      productId,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }
}
