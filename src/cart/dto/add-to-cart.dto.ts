import { IsMongoId, IsNotEmpty, IsInt, Min } from 'class-validator';

export class AddToCartDto {
  @IsMongoId()
  @IsNotEmpty()
  offerId!: string;

  @IsInt()
  @Min(1)
  @IsNotEmpty()
  quantity!: number;
}
