import { BadRequestException, Injectable } from '@nestjs/common';
import { OfferDiscountTypeEnum } from 'src/Common/Types';

export interface ResolvedPricing {
  originalPrice: number;
  offerPrice: number;
  discountPercentage: number;
  discountType: OfferDiscountTypeEnum;
}

@Injectable()
export class OfferPricingService {
  /**
   * Derives originalPrice/offerPrice/discountPercentage from either a
   * percentage discount or a fixed offer price — exactly one must be given.
   */
  resolvePricing(
    productPrice: number,
    input: {
      discountType: OfferDiscountTypeEnum;
      discountPercentage?: number;
      offerPrice?: number;
    },
  ): ResolvedPricing {
    const { discountType } = input;
    const hasPercentage = input.discountPercentage !== undefined;
    const hasOfferPrice = input.offerPrice !== undefined;

    if (hasPercentage && hasOfferPrice) {
      throw new BadRequestException(
        'Provide either discountPercentage or offerPrice, not both',
      );
    }
    if (!hasPercentage && !hasOfferPrice) {
      throw new BadRequestException(
        'Provide either discountPercentage or offerPrice',
      );
    }

    const originalPrice = productPrice;

    if (discountType === OfferDiscountTypeEnum.FIXED) {
      if (!hasOfferPrice) {
        throw new BadRequestException(
          'offerPrice is required when discountType is fixed',
        );
      }
      if (input.offerPrice! <= 0 || input.offerPrice! >= originalPrice) {
        throw new BadRequestException(
          'offerPrice must be greater than 0 and less than the product price',
        );
      }
      const rawDiscount = (1 - input.offerPrice! / originalPrice) * 100;
      const discountPercentage = Math.min(
        100,
        Math.max(1, Math.round(rawDiscount)),
      );
      return {
        originalPrice,
        offerPrice: Math.round(input.offerPrice! * 100) / 100,
        discountPercentage,
        discountType,
      };
    }

    if (!hasPercentage) {
      throw new BadRequestException(
        'discountPercentage is required when discountType is percentage',
      );
    }
    const offerPrice =
      Math.round(originalPrice * (1 - input.discountPercentage! / 100) * 100) /
      100;
    return {
      originalPrice,
      offerPrice,
      discountPercentage: input.discountPercentage!,
      discountType,
    };
  }
}
