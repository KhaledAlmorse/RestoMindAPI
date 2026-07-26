import { IsEnum, IsNotEmpty } from 'class-validator';
import { ImportTypeEnum } from 'src/Common/Types';

export class CreateImportDto {
  @IsEnum(ImportTypeEnum)
  @IsNotEmpty()
  importType!: ImportTypeEnum;
}
