import { IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import { PurchaseOrderStatusEnum } from 'src/Common/Types';

export class QueryPurchaseOrderDto {
  @IsString()
  @IsOptional()
  page?: string;

  @IsString()
  @IsOptional()
  limit?: string;

  @IsEnum(PurchaseOrderStatusEnum)
  @IsOptional()
  status?: PurchaseOrderStatusEnum;

  @IsMongoId()
  @IsOptional()
  supplierId?: string;
}
