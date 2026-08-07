import { ConflictException } from '@nestjs/common';
import {
  SubscriptionFields,
  effectiveProductCap,
  resolveSubscriptionState,
} from 'src/subscriptions/subscription-state';

/** The cheapest plan that would unlock more capacity, for the error body. */
export interface UpgradeHint {
  slug: string;
  label: string;
  priceEGP: number;
}

/**
 * Throws unless the restaurant may hold one more product.
 *
 * Stays pure and synchronous: the cap comes from the subscription snapshot,
 * so enforcing it costs no database round-trip on the create path. The caller
 * supplies the upgrade hint because only it can load plans — and a missing
 * hint degrades to a plain limit message rather than a wrong one.
 *
 * ponytail: unlocked count-then-insert — two concurrent creates could land at
 * cap+1. At a 1,000-product cap that is commercially meaningless; add a
 * per-restaurant lock only if caps ever drop to single digits.
 */
export function assertProductCapacity(
  sub: SubscriptionFields | undefined | null,
  currentProductCount: number,
  upgradeHint: UpgradeHint | null = null,
): void {
  const state = resolveSubscriptionState(sub);
  const cap = effectiveProductCap(sub, state);

  if (currentProductCount < cap) return;

  const label = sub?.planLabelSnapshot;

  throw new ConflictException({
    code: 'PRODUCT_LIMIT_REACHED',
    message:
      cap > 0
        ? `You have reached the ${label ?? 'current'} limit of ${cap} products.`
        : 'Your subscription is not active, so new products cannot be created.',
    state,
    current: currentProductCount,
    cap: Number.isFinite(cap) ? cap : null,
    nextPlan: upgradeHint,
  });
}
