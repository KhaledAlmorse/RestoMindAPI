import { Logger } from '@nestjs/common';

const logger = new Logger('CORS');

/**
 * Shared Express/Socket.IO origin check, used by both the REST API
 * (main.ts) and the notification WebSocket gateway so the two can't drift.
 *
 * Falls open (any origin) only outside production, for local dev convenience.
 * validateEnvironment() refuses to boot a production process with
 * ALLOWED_ORIGINS unset or "*", so this never falls open in production.
 */
export function corsOriginHandler(
  requestOrigin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  // No Origin header: same-origin, curl, mobile apps, server-to-server.
  if (!requestOrigin) return callback(null, true);

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const openByDefault =
    allowedOrigins.length === 0 || allowedOrigins.includes('*');

  if (openByDefault) {
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
  } else if (allowedOrigins.includes(requestOrigin)) {
    return callback(null, true);
  }

  logger.warn(`CORS rejected request from origin: ${requestOrigin}`);
  callback(new Error('Not allowed by CORS'));
}
