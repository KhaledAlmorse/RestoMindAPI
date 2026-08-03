import { IsMongoId, IsOptional, IsString } from 'class-validator';

export class QueryBatchDto {
  @IsString()
  @IsOptional()
  page?: string;

  @IsString()
  @IsOptional()
  limit?: string;

  @IsMongoId()
  @IsOptional()
  ingredientId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  restaurantId?: string;
}
