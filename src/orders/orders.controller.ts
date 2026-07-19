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
  UnauthorizedException,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CreateOrderDto } from './dto/create-order.dto';
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
  @Auth('customer', 'admin', 'manager')
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
  @Auth('customer', 'admin', 'manager')
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

  @Get()
  @Auth('admin')
  async getAllOrders(
    @Query('restaurantId') restaurantId: string,
    @Res() res: Response,
  ) {
    const result = await this.ordersService.getAllOrders(restaurantId);
    res.status(HttpStatus.OK).json(result);
  }

  @Get('restaurant/:restaurantId')
  @Auth('admin', 'manager')
  async getRestaurantOrders(
    @Param('restaurantId') restaurantId: string,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    if (user.user.role === RolesEnum.MANAGER) {
      if (
        !user.user.restaurantId ||
        user.user.restaurantId.toString() !== restaurantId
      ) {
        throw new UnauthorizedException(
          'You can only view orders for your own restaurant',
        );
      }
    }
    const result = await this.ordersService.getRestaurantOrders(restaurantId);
    res.status(HttpStatus.OK).json(result);
  }

  @Patch(':id/status')
  @Auth('admin')
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() body: UpdateOrderStatusDto,
    @Res() res: Response,
  ) {
    const result = await this.ordersService.updateOrderStatus(id, body.status);
    res.status(HttpStatus.OK).json(result);
  }
}
