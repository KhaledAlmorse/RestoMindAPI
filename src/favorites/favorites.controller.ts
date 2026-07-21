import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { type Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { type IAuthUser } from 'src/Common/Types';

@Controller('favorites')
@Auth('customer')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post(':offerId')
  async addFavorite(
    @Param('offerId') offerId: string,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.favoritesService.addFavorite(
      user.user._id.toString(),
      offerId,
    );
    res.status(HttpStatus.CREATED).json(result);
  }

  @Delete(':offerId')
  async removeFavorite(
    @Param('offerId') offerId: string,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.favoritesService.removeFavorite(
      user.user._id.toString(),
      offerId,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get()
  async getFavorites(@AuthUser() user: IAuthUser, @Res() res: Response) {
    const result = await this.favoritesService.getFavorites(
      user.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get(':offerId/status')
  async checkFavoriteStatus(
    @Param('offerId') offerId: string,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.favoritesService.checkFavoriteStatus(
      user.user._id.toString(),
      offerId,
    );
    res.status(HttpStatus.OK).json(result);
  }
}
