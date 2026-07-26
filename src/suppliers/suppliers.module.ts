import { Module } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import {
  RestaurantRepository,
  SupplierRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { SupplierModel, RestaurantModel, UserModel } from 'src/DB/Models';

@Module({
  imports: [SupplierModel, RestaurantModel, UserModel],
  controllers: [SuppliersController],
  providers: [
    SuppliersService,
    SupplierRepository,
    RestaurantRepository,
    UserRepository,
  ],
  exports: [SuppliersService, SupplierRepository],
})
export class SuppliersModule {}
