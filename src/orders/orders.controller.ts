import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { type Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { type IAuthUser } from 'src/Common/Types';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Auth('customer')
  async createOrder(@AuthUser() user: IAuthUser, @Res() res: Response) {
    const result = await this.ordersService.createOrder(
      user.user._id.toString(),
    );
    res.status(HttpStatus.CREATED).json(result);
  }

  @Get('me')
  @Auth('customer')
  async getMyOrders(@AuthUser() user: IAuthUser, @Res() res: Response) {
    const result = await this.ordersService.getMyOrders(
      user.user._id.toString(),
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

  @Get()
  @Auth('admin')
  async getAllOrders(@Res() res: Response) {
    const result = await this.ordersService.getAllOrders();
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
