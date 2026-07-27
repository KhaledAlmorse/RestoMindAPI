import { IsEnum, IsNotEmpty } from 'class-validator';
import { PurchaseOrderStatusEnum } from 'src/Common/Types';

export class UpdatePurchaseOrderStatusDto {
  @IsEnum(PurchaseOrderStatusEnum)
  @IsNotEmpty()
  status!: PurchaseOrderStatusEnum;
}
