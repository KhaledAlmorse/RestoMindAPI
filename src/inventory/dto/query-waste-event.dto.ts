import { IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import { WasteReasonEnum } from 'src/Common/Types';

export class QueryWasteEventDto {
  @IsString()
  @IsOptional()
  page?: string;

  @IsString()
  @IsOptional()
  limit?: string;

  @IsMongoId()
  @IsOptional()
  ingredientId?: string;

  @IsEnum(WasteReasonEnum)
  @IsOptional()
  wasteReason?: WasteReasonEnum;
}
