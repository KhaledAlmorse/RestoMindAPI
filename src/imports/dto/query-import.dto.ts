import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ImportJobStatusEnum, ImportTypeEnum } from 'src/Common/Types';

export class QueryImportDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsEnum(ImportTypeEnum)
  importType?: ImportTypeEnum;

  @IsOptional()
  @IsEnum(ImportJobStatusEnum)
  status?: ImportJobStatusEnum;
}
