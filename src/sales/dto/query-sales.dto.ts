import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsMongoId, IsOptional, IsString, Min } from 'class-validator';
import { SalesSourceEnum } from 'src/Common/Types';

export class QuerySalesDto {
  @IsOptional()
  @IsMongoId()
  restaurantId?: string;

  @IsOptional()
  @IsMongoId()
  productId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(SalesSourceEnum)
  source?: SalesSourceEnum;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  sort?: string = 'date';

  @IsOptional()
  @IsString()
  order?: 'asc' | 'desc' = 'desc';
}
