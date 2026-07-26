import { IsOptional, IsString } from 'class-validator';

export class QuerySupplierDto {
  @IsString()
  @IsOptional()
  page?: string;

  @IsString()
  @IsOptional()
  limit?: string;

  @IsString()
  @IsOptional()
  search?: string;
}
