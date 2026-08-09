/**
 * Outcome of a call to the AI microservice.
 *
 * The distinction matters: `client_error` means WE sent something wrong (an
 * unknown SKU, a malformed body) and retrying or silently falling back would
 * hide a real bug. `unavailable` means the service could not answer, which is
 * exactly when a fallback is correct. `rate_limited` means the service
 * throttled us (HTTP 429) — not our request, not an outage, and never worth a
 * blind retry.
 */
export type AiCallResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      kind: 'unavailable' | 'client_error' | 'rate_limited';
      status?: number;
      message: string;
      body?: unknown;
      retryAfter?: number;
    };

/**
 * A failure that actually reached an endpoint's response, carrying the KIND so
 * the caller (and the dashboard) can tell "the AI is down" from "we are
 * misconfigured and every call is being rejected without a retry" from "we are
 * being rate-limited".
 */
export interface AiDegradation {
  kind: 'unavailable' | 'client_error' | 'rate_limited';
  reason: string;
  status?: number;
  retryAfter?: number;
}

/**
 * Envelope for any endpoint whose answer may come from a fallback rather than
 * the model. The UI renders a warning when `degraded` is true, so it must never
 * be omitted on an AI-backed route.
 */
export interface DegradableResponse<T> {
  data: T;
  degraded: boolean;
  degradedReason?: string;
  degradedKind?: AiDegradation['kind'];
  degradedStatus?: number;
}
