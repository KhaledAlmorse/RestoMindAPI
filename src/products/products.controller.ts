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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { UpdateProductAvailabilityDto } from './dto/update-product-availability.dto';
import { UpdateProductDiscountDto } from './dto/update-product-discount.dto';
import { type Response } from 'express';
import { Auth } from 'src/Common/Decorators';
import { FileInterceptor } from '@nestjs/platform-express';
import { uploadFileOptions } from 'src/Common/Utils/multer.utils';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Auth('admin')
  @UseInterceptors(FileInterceptor('image', uploadFileOptions({})))
  async createProduct(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateProductDto,
    @Res() res: Response,
  ) {
    const result = await this.productsService.createProduct(body, file);
    res.status(HttpStatus.CREATED).json(result);
  }

  @Patch(':id')
  @Auth('admin')
  @UseInterceptors(FileInterceptor('image', uploadFileOptions({})))
  async updateProduct(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UpdateProductDto,
    @Res() res: Response,
  ) {
    const result = await this.productsService.updateProduct(id, body, file);
    res.status(HttpStatus.OK).json(result);
  }

  @Delete(':id')
  @Auth('admin')
  async deleteProduct(@Param('id') id: string, @Res() res: Response) {
    const result = await this.productsService.deleteProduct(id);
    res.status(HttpStatus.OK).json(result);
  }

  @Patch(':id/availability')
  @Auth('admin')
  async changeAvailability(
    @Param('id') id: string,
    @Body() body: UpdateProductAvailabilityDto,
    @Res() res: Response,
  ) {
    const result = await this.productsService.changeAvailability(
      id,
      body.isAvailable,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Patch(':id/discount')
  @Auth('admin')
  async updateDiscount(
    @Param('id') id: string,
    @Body() body: UpdateProductDiscountDto,
    @Res() res: Response,
  ) {
    const result = await this.productsService.updateDiscount(
      id,
      body.discountedPrice,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get()
  async getAllProducts(@Query() query: QueryProductDto, @Res() res: Response) {
    const result = await this.productsService.getAllProducts(query);
    res.status(HttpStatus.OK).json(result);
  }

  @Get('recommendations')
  async getRecommendations(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Res() res: Response,
  ) {
    const result = await this.productsService.getRecommendations({
      page,
      limit,
    });
    res.status(HttpStatus.OK).json(result);
  }

  @Get(':id')
  async getProductDetails(@Param('id') id: string, @Res() res: Response) {
    const result = await this.productsService.getProductDetails(id);
    res.status(HttpStatus.OK).json(result);
  }
}
