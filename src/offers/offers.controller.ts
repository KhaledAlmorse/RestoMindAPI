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
import { OffersService } from './offers.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { QueryOfferDto } from './dto/query-offer.dto';
import { type Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import type { IAuthUser } from 'src/Common/Types';

@Controller('offers')
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Post()
  @Auth('manager')
  async createOffer(
    @Body() body: CreateOfferDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.offersService.createOffer(
      body,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.CREATED).json(result);
  }

  @Get('active')
  async getActiveOffers(
    @Query() query: QueryOfferDto,
    @Res() res: Response,
  ) {
    const result = await this.offersService.getActiveOffers(query);
    res.status(HttpStatus.OK).json(result);
  }

  @Get('active/:id')
  async getActiveOfferById(@Param('id') id: string, @Res() res: Response) {
    const result = await this.offersService.getActiveOfferById(id);
    res.status(HttpStatus.OK).json(result);
  }

  @Get()
  @Auth('manager')
  async getOffers(
    @Query() query: QueryOfferDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.offersService.getOffers(
      query,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get(':id')
  @Auth('manager')
  async getOfferById(
    @Param('id') id: string,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.offersService.getOfferById(
      id,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Patch(':id')
  @Auth('manager')
  async updateOffer(
    @Param('id') id: string,
    @Body() body: UpdateOfferDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.offersService.updateOffer(
      id,
      body,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Patch(':id/cancel')
  @Auth('manager')
  async cancelOffer(
    @Param('id') id: string,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.offersService.cancelOffer(
      id,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }
}
