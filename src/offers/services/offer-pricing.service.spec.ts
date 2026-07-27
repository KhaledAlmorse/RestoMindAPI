import { BadRequestException } from '@nestjs/common';
import { OfferPricingService } from './offer-pricing.service';
import { OfferDiscountTypeEnum } from 'src/Common/Types';

describe('OfferPricingService', () => {
  let service: OfferPricingService;

  beforeEach(() => {
    service = new OfferPricingService();
  });

  it('derives offerPrice from a percentage discount', () => {
    const result = service.resolvePricing(100, {
      discountType: OfferDiscountTypeEnum.PERCENTAGE,
      discountPercentage: 20,
    });

    expect(result.offerPrice).toBe(80);
    expect(result.discountPercentage).toBe(20);
    expect(result.originalPrice).toBe(100);
  });

  it('derives discountPercentage from a fixed offerPrice', () => {
    const result = service.resolvePricing(100, {
      discountType: OfferDiscountTypeEnum.FIXED,
      offerPrice: 75,
    });

    expect(result.offerPrice).toBe(75);
    expect(result.discountPercentage).toBe(25);
    expect(result.discountType).toBe(OfferDiscountTypeEnum.FIXED);
  });

  it('rejects providing both discountPercentage and offerPrice', () => {
    expect(() =>
      service.resolvePricing(100, {
        discountType: OfferDiscountTypeEnum.PERCENTAGE,
        discountPercentage: 20,
        offerPrice: 75,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects providing neither discountPercentage nor offerPrice', () => {
    expect(() =>
      service.resolvePricing(100, {
        discountType: OfferDiscountTypeEnum.PERCENTAGE,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a fixed offerPrice greater than or equal to the product price', () => {
    expect(() =>
      service.resolvePricing(100, {
        discountType: OfferDiscountTypeEnum.FIXED,
        offerPrice: 100,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a fixed offerPrice of 0 or less', () => {
    expect(() =>
      service.resolvePricing(100, {
        discountType: OfferDiscountTypeEnum.FIXED,
        offerPrice: 0,
      }),
    ).toThrow(BadRequestException);
  });
});
