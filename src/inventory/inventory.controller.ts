import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { CreateBatchDto, CreateBatchesDto } from './dto/create-batch.dto';
import { QueryBatchDto } from './dto/query-batch.dto';
import { CreateStockTransactionDto } from './dto/create-stock-transaction.dto';
import { QueryStockTransactionDto } from './dto/query-stock-transaction.dto';
import { CreateWasteEventDto } from './dto/create-waste-event.dto';
import { QueryWasteEventDto } from './dto/query-waste-event.dto';
import { type Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import type { IAuthUser } from 'src/Common/Types';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // --- Batches ---

  @Post('batches')
  @Auth('admin', 'manager', 'staff')
  async createBatch(
    @Body() body: CreateBatchDto | CreateBatchesDto | CreateBatchDto[],
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.inventoryService.createBatch(
      body,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.CREATED).json(result);
  }

  @Get('batches')
  @Auth('admin', 'manager', 'staff')
  async getBatches(
    @Query() query: QueryBatchDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.inventoryService.getBatches(
      query,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  // --- Stock Transactions ---

  @Post('transactions')
  @Auth('admin', 'manager', 'staff')
  async createStockTransaction(
    @Body() body: CreateStockTransactionDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.inventoryService.createStockTransaction(
      body,
      authUser.user,
    );
    res.status(HttpStatus.CREATED).json(result);
  }

  @Get('transactions')
  @Auth('admin', 'manager', 'staff')
  async getStockTransactions(
    @Query() query: QueryStockTransactionDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.inventoryService.getStockTransactions(
      query,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  // --- Waste Events ---

  @Post('waste-events')
  @Auth('admin', 'manager', 'staff')
  async createWasteEvent(
    @Body() body: CreateWasteEventDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.inventoryService.createWasteEvent(
      body,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.CREATED).json(result);
  }

  @Get('waste-events')
  @Auth('admin', 'manager', 'staff')
  async getWasteEvents(
    @Query() query: QueryWasteEventDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.inventoryService.getWasteEvents(
      query,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }
}
