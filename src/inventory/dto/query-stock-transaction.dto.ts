import { IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import { StockTransactionTypeEnum } from 'src/Common/Types';

export class QueryStockTransactionDto {
  @IsString()
  @IsOptional()
  page?: string;

  @IsString()
  @IsOptional()
  limit?: string;

  @IsMongoId()
  @IsOptional()
  ingredientId?: string;

  @IsEnum(StockTransactionTypeEnum)
  @IsOptional()
  transactionType?: StockTransactionTypeEnum;
}
