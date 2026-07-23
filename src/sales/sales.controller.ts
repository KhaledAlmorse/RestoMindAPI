import { Controller, Get, HttpStatus, Query, Res } from '@nestjs/common';
import { type Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import type { IAuthUser } from 'src/Common/Types';
import { QuerySalesDto } from './dto/query-sales.dto';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get('summary')
  @Auth('manager', 'admin')
  async getSalesSummary(
    @Query() query: QuerySalesDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.salesService.getSalesSummary(
      authUser.user,
      query,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get()
  @Auth('manager', 'admin')
  async getSales(
    @Query() query: QuerySalesDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.salesService.getSales(authUser.user, query);
    res.status(HttpStatus.OK).json(result);
  }
}
