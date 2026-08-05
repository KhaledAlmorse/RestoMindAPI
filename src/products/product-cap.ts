import { ConflictException } from '@nestjs/common';
import {
  TIERS,
  nextTierAfter,
} from 'src/subscriptions/subscription-tiers.config';
import {
  SubscriptionFields,
  effectiveProductCap,
  effectiveTier,
  resolveSubscriptionState,
} from 'src/subscriptions/subscription-state';

/**
 * Throws unless the restaurant may hold one more product.
 *
 * The thrown body carries the next tier and its price so the frontend can
 * offer a concrete upgrade rather than a dead end.
 *
 * ponytail: unlocked count-then-insert — two concurrent creates could land at
 * cap+1. At a 1,000-product cap that is commercially meaningless; add a
 * per-restaurant lock only if caps ever drop to single digits.
 */
export function assertProductCapacity(
  sub: SubscriptionFields | undefined | null,
  currentProductCount: number,
): void {
  const state = resolveSubscriptionState(sub);
  const cap = effectiveProductCap(sub, state);

  if (currentProductCount < cap) return;

  const tier = effectiveTier(sub, state);
  const next = nextTierAfter(tier ?? undefined);

  throw new ConflictException({
    code: 'PRODUCT_LIMIT_REACHED',
    message: tier
      ? `You have reached the ${TIERS[tier].label} limit of ${cap} products.`
      : 'Your subscription is not active, so new products cannot be created.',
    state,
    current: currentProductCount,
    cap: Number.isFinite(cap) ? cap : null,
    nextTier: next,
    nextTierPriceEGP: next ? TIERS[next].priceEGP : null,
  });
}
