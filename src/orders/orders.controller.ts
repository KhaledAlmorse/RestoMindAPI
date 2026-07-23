import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Res,
  HttpStatus,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryRestaurantOrdersDto } from './dto/query-restaurant-orders.dto';
import { QueryOrderListingDto } from './dto/query-order-listing.dto';
import { type Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { RolesEnum, type IAuthUser } from 'src/Common/Types';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Auth('customer')
  async createOrder(
    @AuthUser() user: IAuthUser,
    @Body() body: CreateOrderDto,
    @Res() res: Response,
  ) {
    const result = await this.ordersService.createOrder(
      user.user._id.toString(),
      body,
    );
    res.status(HttpStatus.CREATED).json(result);
  }

  @Get('me')
  @Auth('customer')
  async getMyOrders(
    @AuthUser() user: IAuthUser,
    @Query('restaurantId') restaurantId: string,
    @Res() res: Response,
  ) {
    const result = await this.ordersService.getMyOrders(
      user.user._id.toString(),
      restaurantId,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get('me/:id')
  @Auth('customer')
  async getMyOrderDetails(
    @Param('id') id: string,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.ordersService.getMyOrderDetails(
      user.user._id.toString(),
      id,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get('group/:id')
  @Auth('customer', 'admin')
  async getGroupOrderDetails(
    @Param('id') id: string,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.ordersService.getOrderGroupById(id, user.user);
    res.status(HttpStatus.OK).json(result);
  }

  @Get()
  @Auth('admin')
  async getAllOrders(
    @Query() query: QueryOrderListingDto,
    @Res() res: Response,
  ) {
    const result = await this.ordersService.getAllOrders(query);
    res.status(HttpStatus.OK).json(result);
  }

  @Get('restaurant/:restaurantId')
  @Auth('admin', 'manager')
  async getRestaurantOrders(
    @Param('restaurantId') restaurantId: string,
    @Query() query: QueryRestaurantOrdersDto,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    if (user.user.role === RolesEnum.MANAGER) {
      if (
        !user.user.restaurantId ||
        user.user.restaurantId.toString() !== restaurantId
      ) {
        throw new ForbiddenException(
          'You can only view orders for your own restaurant',
        );
      }
    }
    const result = await this.ordersService.getRestaurantOrders(
      restaurantId,
      query,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Patch(':id/status')
  @Auth('admin', 'manager')
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() body: UpdateOrderStatusDto,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.ordersService.updateOrderStatus(
      id,
      body.status,
      user.user,
    );
    res.status(HttpStatus.OK).json(result);
  }
}

@Controller('order-groups')
@Auth('admin')
export class OrderGroupsController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(':id')
  async getOrderGroup(
    @Param('id') id: string,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.ordersService.getOrderGroupById(id, user.user);
    res.status(HttpStatus.OK).json(result);
  }
}
