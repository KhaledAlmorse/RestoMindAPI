import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import type { IAuthUser } from 'src/Common/Types';
import { ProductionPlanningService } from './production-planning.service';
import { QueryProductionPlanDto } from './dto/query-production-plan.dto';
import { RecordActualsDto } from './dto/record-actuals.dto';

@Controller('predictions/production-plan')
export class ProductionPlanningController {
  constructor(
    private readonly productionPlanningService: ProductionPlanningService,
  ) {}

  @Get()
  @Auth('admin', 'manager', 'staff')
  async getProductionPlan(
    @Query() query: QueryProductionPlanDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const userId = authUser.user._id.toString();
    const result = await this.productionPlanningService.getProductionPlan(
      userId,
      query.date,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Post('actuals')
  @Auth('admin', 'manager', 'staff')
  async recordActuals(
    @Body() body: RecordActualsDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const userId = authUser.user._id.toString();
    const result = await this.productionPlanningService.recordActuals(
      userId,
      body,
    );
    res.status(HttpStatus.OK).json(result);
  }
}
