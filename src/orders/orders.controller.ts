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
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { QueryOrderListingDto } from './dto/query-order-listing.dto';
import { type Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { type IAuthUser } from 'src/Common/Types';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // 1. POST /orders - Create order from user's active cart
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

  // 2. GET /orders/group/:id - Get order group by group ID (Client, Admin)
  @Get('group/:id')
  @Auth('customer', 'admin')
  async getGroupOrderById(
    @Param('id') id: string,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.ordersService.getGroupOrderById(id, user.user);
    res.status(HttpStatus.OK).json(result);
  }

  // 2b. PATCH /orders/group/:id/cancel - Cancel order group by client
  @Patch('group/:id/cancel')
  @Auth('customer')
  async cancelOrderGroup(
    @Param('id') id: string,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.ordersService.cancelOrderGroup(id, user.user);
    res.status(HttpStatus.OK).json(result);
  }

  // 3. GET /orders/:id - Get child order by ID (Client, Manager, Admin, Staff)
  @Get(':id')
  @Auth('customer', 'manager', 'admin', 'staff')
  async getChildOrderById(
    @Param('id') id: string,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.ordersService.getChildOrderById(id, user.user);
    res.status(HttpStatus.OK).json(result);
  }

  // 4. PATCH /orders/:id/status - Update child order status (Manager, Admin, Staff)
  @Patch(':id/status')
  @Auth('admin', 'manager', 'staff')
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

  // 5. GET /orders - Get all orders role-aware (Client, Manager, Admin, Staff)
  @Get()
  @Auth('customer', 'manager', 'admin', 'staff')
  async getAllOrders(
    @Query() query: QueryOrderListingDto,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.ordersService.getAllOrders(query, user.user);
    res.status(HttpStatus.OK).json(result);
  }
}
