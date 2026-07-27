import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';
import { UpdatePurchaseOrderStatusDto } from './dto/update-purchase-order-status.dto';
import { type Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import type { IAuthUser } from 'src/Common/Types';

@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Post()
  @Auth('manager')
  async createPurchaseOrder(
    @Body() body: CreatePurchaseOrderDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.purchaseOrdersService.createPurchaseOrder(
      body,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.CREATED).json(result);
  }

  @Get()
  @Auth('manager')
  async getPurchaseOrders(
    @Query() query: QueryPurchaseOrderDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.purchaseOrdersService.getPurchaseOrders(
      query,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Patch(':id/receive')
  @Auth('manager')
  async receivePurchaseOrder(
    @Param('id') id: string,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.purchaseOrdersService.receivePurchaseOrder(
      id,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Patch(':id/status')
  @Auth('manager')
  async updatePurchaseOrderStatus(
    @Param('id') id: string,
    @Body() body: UpdatePurchaseOrderStatusDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.purchaseOrdersService.updatePurchaseOrderStatus(
      id,
      body.status,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }
}
