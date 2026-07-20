import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { IngredientsService } from './ingredients.service';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';
import { QueryIngredientDto } from './dto/query-ingredient.dto';
import { type Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import type { IAuthUser } from 'src/Common/Types';

@Controller('ingredients')
export class IngredientsController {
  constructor(private readonly ingredientsService: IngredientsService) {}

  @Post()
  @Auth('manager')
  async createIngredient(
    @Body() body: CreateIngredientDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.ingredientsService.createIngredient(
      body,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.CREATED).json(result);
  }

  @Get()
  @Auth('manager')
  async getIngredients(
    @Query() query: QueryIngredientDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.ingredientsService.getIngredients(
      query,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get(':id')
  @Auth('manager')
  async getIngredientById(
    @Param('id') id: string,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.ingredientsService.getIngredientById(
      id,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Patch(':id')
  @Auth('manager')
  async updateIngredient(
    @Param('id') id: string,
    @Body() body: UpdateIngredientDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.ingredientsService.updateIngredient(
      id,
      body,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Delete(':id')
  @Auth('manager')
  async deleteIngredient(
    @Param('id') id: string,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.ingredientsService.deleteIngredient(
      id,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }
}
