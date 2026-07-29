import { Controller, Get, HttpStatus, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import type { IAuthUser } from 'src/Common/Types';
import { WasteReportsService } from './waste-reports.service';
import { QueryWasteReportDto } from './dto/query-waste-report.dto';

@Controller('waste-reports')
export class WasteReportsController {
  constructor(private readonly wasteReportsService: WasteReportsService) {}

  @Get()
  @Auth('manager')
  async findAll(
    @Query() query: QueryWasteReportDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const userId = authUser.user._id.toString();
    const result = await this.wasteReportsService.findAll(userId, query);
    res.status(HttpStatus.OK).json(result);
  }

  @Get('summary')
  @Auth('manager')
  async getSummary(
    @Query('days') days: string | undefined,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const userId = authUser.user._id.toString();
    const parsed = Number(days);
    const window =
      Number.isFinite(parsed) && parsed > 0 && parsed <= 365 ? parsed : 30;
    const result = await this.wasteReportsService.getSummary(userId, window);
    res.status(HttpStatus.OK).json(result);
  }
}
