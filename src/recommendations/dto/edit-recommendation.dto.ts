import { IsNumber, IsPositive } from 'class-validator';

export class EditRecommendationDto {
  @IsNumber()
  @IsPositive()
  suggestedValue!: number;
}
