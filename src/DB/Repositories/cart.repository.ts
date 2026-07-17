import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Cart, CartType } from '../Models/cart.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class CartRepository extends BaseService<CartType> {
  constructor(
    @InjectModel(Cart.name) private readonly cartModel: Model<CartType>,
  ) {
    super(cartModel);
  }
}
