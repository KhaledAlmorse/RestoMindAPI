import { Throttle } from '@nestjs/throttler';

/**
 * Stricter rate limit for authentication & account creation endpoints.
 * Default: 5 requests / 60 seconds per IP.
 */
export const AuthThrottle = () =>
  Throttle({
    default: {
      limit: process.env.LOGIN_RATE_LIMIT
        ? parseInt(process.env.LOGIN_RATE_LIMIT)
        : 10,
      ttl:
        (process.env.RATE_LIMIT_TTL
          ? parseInt(process.env.RATE_LIMIT_TTL)
          : 60) * 1000,
    },
  });

/**
 * Moderate rate limit for AI-triggering endpoints to protect AI microservice.
 * Default: 20 requests / 60 seconds per IP.
 */
export const AiThrottle = () =>
  Throttle({
    default: {
      limit: process.env.AI_ENDPOINT_RATE_LIMIT
        ? parseInt(process.env.AI_ENDPOINT_RATE_LIMIT)
        : 20,
      ttl:
        (process.env.RATE_LIMIT_TTL
          ? parseInt(process.env.RATE_LIMIT_TTL)
          : 60) * 1000,
    },
  });
