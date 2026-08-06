import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const SENSITIVE_KEYS = [
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'resettoken',
  'setuptoken',
  'authorization',
  'otp',
  'secret',
  'apikey',
  'api_key',
  'creditcard',
  'cvv',
];

function sanitizeObject(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((sKey) => lowerKey.includes(sKey))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      sanitized[key] = sanitizeObject(val);
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

@Injectable()
export class SanitizedLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, originalUrl, body, headers } = request;

    // Sanitize headers and body for logging
    const safeHeaders = { ...headers };
    if (safeHeaders['authorization']) {
      safeHeaders['authorization'] = '[REDACTED]';
    }

    const safeBody = sanitizeObject(body);
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const response = context.switchToHttp().getResponse();
          const statusCode = response.statusCode;
          this.logger.log(
            `${method} ${originalUrl} ${statusCode} - ${duration}ms`,
          );
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const status = error?.status || 500;
          this.logger.warn(
            `${method} ${originalUrl} ${status} - ${duration}ms - Message: ${error?.message}`,
          );
        },
      }),
    );
  }
}
