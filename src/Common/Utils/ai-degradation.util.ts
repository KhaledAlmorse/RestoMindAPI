import type { Logger } from '@nestjs/common';
import type { AiCallResult, AiDegradation } from '../Types/ai.types';

/** The failure half of an AiCallResult. */
export type AiFailure = Extract<AiCallResult<unknown>, { ok: false }>;

/**
 * Log an AI failure at the level its KIND deserves, and return the descriptor
 * the endpoint must surface to its caller.
 *
 * Every AI caller used to branch on `aiResult.ok` alone and log "AI endpoint
 * unreachable", which meant a 401 from a missing `AI_API_KEY` — a
 * configuration fault that is never retried — read exactly like an outage.
 * The endpoint still answered HTTP 200 with a full set of silently-degraded
 * fallback rows, so a misconfigured deployment looked healthy.
 *
 * `client_error` therefore gets its own wording, naming it as a probable
 * configuration fault and carrying the status, the path and the service's own
 * response body.
 */
export function reportAiFailure(
  logger: Logger,
  path: string,
  failure: AiFailure,
  context?: string,
): AiDegradation {
  const where = context ? ` (${context})` : '';

  if (failure.kind === 'client_error') {
    logger.error(
      `[AI CONFIG ERROR] AI rejected ${path}${where} with HTTP ${
        failure.status ?? '4xx'
      } and it was NOT retried. This is a request/configuration fault, not an outage — ` +
        `a 401/403 almost always means AI_API_KEY is missing or does not match the AI service's X-API-Key. ` +
        `Response body: ${safeJson(failure.body)}`,
    );
  } else {
    logger.error(
      `[AI UNAVAILABLE] AI endpoint unreachable for ${path}${where}: ${failure.message}` +
        (failure.status ? ` (last HTTP ${failure.status})` : ''),
    );
  }

  return {
    kind: failure.kind,
    reason: failure.message,
    ...(failure.status === undefined ? {} : { status: failure.status }),
  };
}

/**
 * The degradation fields every AI-backed endpoint appends to its response, so
 * a caller can tell a fallback answer from a real one — and tell a
 * misconfiguration apart from an outage.
 */
export function degradationFields(degradation?: AiDegradation | null): {
  degraded: boolean;
  degradedReason?: string;
  degradedKind?: AiDegradation['kind'];
  degradedStatus?: number;
} {
  if (!degradation) return { degraded: false };
  return {
    degraded: true,
    degradedReason: degradation.reason,
    degradedKind: degradation.kind,
    ...(degradation.status === undefined
      ? {}
      : { degradedStatus: degradation.status }),
  };
}

function safeJson(value: unknown): string {
  if (value === undefined) return '<no body>';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
