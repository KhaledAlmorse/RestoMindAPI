import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateProductAvailabilityDto {
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    return value === 'true' || value === true || value === 1 || value === '1';
  })
  @IsBoolean()
  @IsOptional()
  isAvailable?: boolean;
}
