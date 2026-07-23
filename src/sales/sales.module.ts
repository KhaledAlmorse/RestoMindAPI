import { Module } from '@nestjs/common';
import { SalesTransactionModel } from 'src/DB/Models';
import { SalesTransactionRepository } from 'src/DB/Repositories';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [SalesTransactionModel],
  controllers: [SalesController],
  providers: [SalesService, SalesTransactionRepository],
  exports: [SalesService, SalesTransactionRepository],
})
export class SalesModule {}
