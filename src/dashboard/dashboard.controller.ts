import { Controller, Get, HttpStatus, Query, Res } from '@nestjs/common';
import { type Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import type { IAuthUser } from 'src/Common/Types';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('admin')
  @Auth('admin')
  async getAdminDashboard(
    @Query() query: DashboardQueryDto,
    @Res() res: Response,
  ) {
    const result = await this.dashboardService.getAdminDashboard(query);
    res.status(HttpStatus.OK).json(result);
  }

  @Get('manager')
  @Auth('manager')
  async getManagerDashboard(
    @AuthUser() user: IAuthUser,
    @Query() query: DashboardQueryDto,
    @Res() res: Response,
  ) {
    const result = await this.dashboardService.getManagerDashboard(user, query);
    res.status(HttpStatus.OK).json(result);
  }
}
