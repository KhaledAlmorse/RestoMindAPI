import { IsNotEmpty, IsString } from 'class-validator';

export class RejectPartnershipApplicationDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
