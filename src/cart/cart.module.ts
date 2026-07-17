import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { CartRepository, ProductRepository } from 'src/DB/Repositories';
import { CartModel, ProductModel } from 'src/DB/Models';

@Module({
  imports: [CartModel, ProductModel],
  controllers: [CartController],
  providers: [CartService, CartRepository, ProductRepository],
  exports: [CartService, CartRepository],
})
export class CartModule {}
