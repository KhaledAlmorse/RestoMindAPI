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
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { RestaurantService } from './restaurant.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { QueryRestaurantDto } from './dto/query-restaurant.dto';
import { type Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { RolesEnum, type IAuthUser } from 'src/Common/Types';
import { FileInterceptor } from '@nestjs/platform-express';
import { uploadFileOptions } from 'src/Common/Utils/multer.utils';

@Controller('restaurants')
export class RestaurantController {
  constructor(private readonly restaurantService: RestaurantService) { }

  @Post()
  @Auth('admin')
  @UseInterceptors(FileInterceptor('image', uploadFileOptions({})))
  async createRestaurant(
    @Body() body: CreateRestaurantDto,
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ) {
    const result = await this.restaurantService.createRestaurant(body, file);
    res.status(HttpStatus.CREATED).json(result);
  }

  @Get()
  async getAllRestaurants(
    @Query() query: QueryRestaurantDto,
    @Res() res: Response,
  ) {
    const result = await this.restaurantService.findAll(query);
    res.status(HttpStatus.OK).json(result);
  }

  @Get('me')
  @Auth('admin', 'manager', 'staff')
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
  @UseInterceptors(FileInterceptor('image', uploadFileOptions({})))
  async updateRestaurant(
    @Param('id') id: string,
    @AuthUser() user: IAuthUser,
    @Body() body: UpdateRestaurantDto,
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ) {
    if (user.user.role === RolesEnum.MANAGER) {
      if (!user.user.restaurantId || user.user.restaurantId.toString() !== id) {
        throw new ForbiddenException('You can only update your own restaurant');
      }
      // Both fields decide money: the rate RestoMind earns and the account the
      // payout lands in. A merchant editing their own restaurant must not be
      // able to zero their commission or redirect a settlement.
      if (
        body.commissionRate !== undefined ||
        body.payoutDestination !== undefined
      ) {
        throw new ForbiddenException(
          'Commission and payout details are set by RestoMind support',
        );
      }
    }
    const result = await this.restaurantService.updateRestaurant(
      id,
      body,
      file,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Delete(':id')
  @Auth('admin')
  async deleteRestaurant(@Param('id') id: string, @Res() res: Response) {
    const result = await this.restaurantService.softDeleteRestaurant(id);
    res.status(HttpStatus.OK).json(result);
  }
}
