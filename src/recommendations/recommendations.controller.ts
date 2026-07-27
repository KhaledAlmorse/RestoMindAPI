import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import type { IAuthUser } from 'src/Common/Types';
import { ApproveRecommendationDto } from './dto/approve-recommendation.dto';
import { EditRecommendationDto } from './dto/edit-recommendation.dto';
import { QueryRecommendationDto } from './dto/query-recommendation.dto';
import { ValidatePlanDto } from './dto/validate-plan.dto';
import { RecommendationsService } from './recommendations.service';

@Controller()
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) {}

  @Get('recommendations')
  @Auth('manager')
  async findAll(
    @Query() query: QueryRecommendationDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const userId = authUser.user._id.toString();
    const result = await this.recommendationsService.findAll(userId, query);
    res.status(HttpStatus.OK).json(result);
  }

  @Post('recommendations/scan-surplus')
  @Auth('manager')
  async scanSurplus(@AuthUser() authUser: IAuthUser, @Res() res: Response) {
    const userId = authUser.user._id.toString();
    const result = await this.recommendationsService.scanSurplus(userId);
    res.status(HttpStatus.OK).json(result);
  }

  @Patch('recommendations/:id/approve')
  @Auth('manager')
  async approve(
    @Param('id') id: string,
    @Body() body: ApproveRecommendationDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const userId = authUser.user._id.toString();
    const result = await this.recommendationsService.approveRecommendation(
      id,
      userId,
      body,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Patch('recommendations/:id/edit')
  @Auth('manager')
  async edit(
    @Param('id') id: string,
    @Body() body: EditRecommendationDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const userId = authUser.user._id.toString();
    const result = await this.recommendationsService.editRecommendation(
      id,
      userId,
      body,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Patch('recommendations/:id/dismiss')
  @Auth('manager')
  async dismiss(
    @Param('id') id: string,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const userId = authUser.user._id.toString();
    const result = await this.recommendationsService.dismissRecommendation(
      id,
      userId,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Post('predictions/validate-plan')
  @Auth('manager')
  async validatePlan(
    @Body() body: ValidatePlanDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const userId = authUser.user._id.toString();
    const result = await this.recommendationsService.validatePlan(userId, body);
    res.status(HttpStatus.OK).json(result);
  }
}
