import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PartnershipApplicationStatusEnum } from 'src/Common/Types';

export class QueryPartnershipApplicationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @IsOptional()
  @IsEnum(PartnershipApplicationStatusEnum)
  status?: PartnershipApplicationStatusEnum;
}
