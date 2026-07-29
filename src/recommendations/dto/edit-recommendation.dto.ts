import { IsNumber, Max, Min } from 'class-validator';

export class EditRecommendationDto {
  /**
   * A discount percentage. Uncapped, this flowed into approveRecommendation's
   * `rec.suggestedValue` fallback — bypassing the @Max(100) on the approve DTO
   * and producing a negative offer price.
   */
  @IsNumber()
  @Min(1)
  @Max(100)
  suggestedValue!: number;
}
