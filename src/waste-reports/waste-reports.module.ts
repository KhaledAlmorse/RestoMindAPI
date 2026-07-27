import { Module } from '@nestjs/common';
import {
  IngredientModel,
  RestaurantModel,
  UserModel,
  WasteReportModel,
} from 'src/DB/Models';
import {
  IngredientRepository,
  RestaurantRepository,
  UserRepository,
  WasteReportRepository,
} from 'src/DB/Repositories';
import { WasteReportsController } from './waste-reports.controller';
import { WasteReportsService } from './waste-reports.service';

@Module({
  imports: [WasteReportModel, UserModel, RestaurantModel, IngredientModel],
  controllers: [WasteReportsController],
  providers: [
    WasteReportsService,
    WasteReportRepository,
    UserRepository,
    RestaurantRepository,
    IngredientRepository,
  ],
  exports: [WasteReportsService, WasteReportRepository],
})
export class WasteReportsModule {}
