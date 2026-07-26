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
import { WeeklyPredictionService } from './weekly-prediction.service';
import { RecalculatePredictionDto } from './dto/recalculate-prediction.dto';
import { BatchRecalculateDto } from './dto/batch-recalculate.dto';
import { QueryPredictionsDto } from './dto/query-predictions.dto';

@Controller('predictions')
export class WeeklyPredictionController {
  constructor(
    private readonly weeklyPredictionService: WeeklyPredictionService,
  ) {}

  @Post('recalculate')
  @HttpCode(HttpStatus.OK)
  @Auth('manager')
  async recalculate(
    @Body() body: RecalculatePredictionDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const userId = authUser.user._id.toString();
    const result = await this.weeklyPredictionService.recalculateSingle(
      userId,
      body.productId,
      body.targetWeek,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Post('batch-recalculate')
  @HttpCode(HttpStatus.OK)
  @Auth('manager')
  async batchRecalculate(
    @Body() body: BatchRecalculateDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const userId = authUser.user._id.toString();
    const result = await this.weeklyPredictionService.batchRecalculate(
      userId,
      body.targetWeek,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get()
  @Auth('manager')
  async getPredictions(
    @Query() query: QueryPredictionsDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const userId = authUser.user._id.toString();
    const result = await this.weeklyPredictionService.getPredictions(
      query,
      userId,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get('learned-status')
  @Auth('manager')
  async getLearnedStatus(
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const userId = authUser.user._id.toString();
    const result = await this.weeklyPredictionService.getLearnedStatus(userId);
    res.status(HttpStatus.OK).json(result);
  }
}
