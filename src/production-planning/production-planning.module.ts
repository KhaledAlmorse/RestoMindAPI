import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DailyProductionPlanModel } from '../DB/Models/daily-production-plan.model';
import { ProductModel } from '../DB/Models/product.model';
import { RestaurantModel } from '../DB/Models/restaurant.model';
import { SalesTransactionModel } from '../DB/Models/sales-transaction.model';
import { UserModel } from '../DB/Models/user.model';
import { DailyProductionPlanRepository } from '../DB/Repositories/daily-production-plan.repository';
import { ProductRepository } from '../DB/Repositories/product.repository';
import { RestaurantRepository } from '../DB/Repositories/restaurant.repository';
import { SalesTransactionRepository } from '../DB/Repositories/sales-transaction.repository';
import { UserRepository } from '../DB/Repositories/user.repository';
import { ImportsModule } from '../imports/imports.module';
import { ProductionPlanningController } from './production-planning.controller';
import { ProductionPlanningService } from './production-planning.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DailyProductionPlanModel,
    RestaurantModel,
    UserModel,
    ProductModel,
    SalesTransactionModel,
    ImportsModule,
  ],
  controllers: [ProductionPlanningController],
  providers: [
    ProductionPlanningService,
    DailyProductionPlanRepository,
    RestaurantRepository,
    UserRepository,
    ProductRepository,
    SalesTransactionRepository,
  ],
  exports: [ProductionPlanningService],
})
export class ProductionPlanningModule {}
