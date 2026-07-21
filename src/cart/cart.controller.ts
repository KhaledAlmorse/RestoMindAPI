import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartQuantityDto } from './dto/update-cart-quantity.dto';
import { type Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { type IAuthUser } from 'src/Common/Types';

@Controller('cart')
@Auth('customer')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getCart(@AuthUser() user: IAuthUser, @Res() res: Response) {
    const result = await this.cartService.getCart(user.user._id.toString());
    res.status(HttpStatus.OK).json(result);
  }

  @Post()
  async addToCart(
    @Body() body: AddToCartDto,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.cartService.addToCart(
      user.user._id.toString(),
      body,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Delete(':offerId')
  async removeFromCart(
    @Param('offerId') offerId: string,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.cartService.removeFromCart(
      user.user._id.toString(),
      offerId,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Patch(':offerId')
  async updateQuantity(
    @Param('offerId') offerId: string,
    @Body() body: UpdateCartQuantityDto,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.cartService.updateQuantity(
      user.user._id.toString(),
      offerId,
      body.quantity,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Delete()
  async clearCart(@AuthUser() user: IAuthUser, @Res() res: Response) {
    const result = await this.cartService.clearCart(user.user._id.toString());
    res.status(HttpStatus.OK).json(result);
  }
}
