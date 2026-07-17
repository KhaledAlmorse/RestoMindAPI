import { IsEnum, IsNotEmpty } from 'class-validator';

export class UpdateOrderStatusDto {
  @IsEnum([
    'Pending',
    'Confirmed',
    'Preparing',
    'Out For Delivery',
    'Delivered',
    'Cancelled',
  ])
  @IsNotEmpty()
  status!: string;
}
