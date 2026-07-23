import { IsEnum, IsNotEmpty } from 'class-validator';
import { OrderStatusEnum } from 'src/Common/Types';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatusEnum)
  @IsNotEmpty()
  status!: OrderStatusEnum;
}
