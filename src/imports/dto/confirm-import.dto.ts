import { IsObject, IsOptional } from 'class-validator';

export class ConfirmImportDto {
  @IsObject()
  @IsOptional()
  columnMapping?: Record<string, string>;
}
