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
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { RestaurantService } from './restaurant.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { QueryRestaurantDto } from './dto/query-restaurant.dto';
import { type Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { RolesEnum, type IAuthUser } from 'src/Common/Types';

@Controller('restaurants')
export class RestaurantController {
  constructor(private readonly restaurantService: RestaurantService) {}

  @Post()
  @Auth('admin')
  async createRestaurant(
    @Body() body: CreateRestaurantDto,
    @Res() res: Response,
  ) {
    const result = await this.restaurantService.createRestaurant(body);
    res.status(HttpStatus.CREATED).json(result);
  }

  @Get()
  @Auth('admin')
  async getAllRestaurants(
    @Query() query: QueryRestaurantDto,
    @Res() res: Response,
  ) {
    const result = await this.restaurantService.findAll(query);
    res.status(HttpStatus.OK).json(result);
  }

  @Get('me')
  @Auth('manager')
  async getMyRestaurant(@AuthUser() user: IAuthUser, @Res() res: Response) {
    if (!user.user.restaurantId) {
      throw new BadRequestException(
        'No restaurant is assigned to your account',
      );
    }
    const result = await this.restaurantService.findById(
      user.user.restaurantId.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get(':id')
  @Auth('admin')
  async getRestaurantById(@Param('id') id: string, @Res() res: Response) {
    const result = await this.restaurantService.findById(id);
    res.status(HttpStatus.OK).json(result);
  }

  @Patch(':id')
  @Auth('admin', 'manager')
  async updateRestaurant(
    @Param('id') id: string,
    @AuthUser() user: IAuthUser,
    @Body() body: UpdateRestaurantDto,
    @Res() res: Response,
  ) {
    if (user.user.role === RolesEnum.MANAGER) {
      if (!user.user.restaurantId || user.user.restaurantId.toString() !== id) {
        throw new ForbiddenException('You can only update your own restaurant');
      }
    }
    const result = await this.restaurantService.updateRestaurant(id, body);
    res.status(HttpStatus.OK).json(result);
  }

  @Delete(':id')
  @Auth('admin')
  async deleteRestaurant(@Param('id') id: string, @Res() res: Response) {
    const result = await this.restaurantService.softDeleteRestaurant(id);
    res.status(HttpStatus.OK).json(result);
  }
}
