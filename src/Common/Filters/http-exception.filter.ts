import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isProduction = process.env.NODE_ENV === 'production';

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // Return exact NestJS HttpException response shape to preserve API compatibility
      return response.status(status).json(
        typeof exceptionResponse === 'object'
          ? exceptionResponse
          : {
              statusCode: status,
              message: exceptionResponse,
            },
      );
    }

    // Log full error details on the server for debugging
    const err = exception as Error;
    this.logger.error(
      `Unhandled Exception on ${request.method} ${request.url}: ${err?.message || err}`,
      err?.stack,
    );

    // Suppress stack trace and internal error details in production
    const responseBody = isProduction
      ? {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        }
      : {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: err?.message || 'Internal server error',
          error: err?.name,
        };

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(responseBody);
  }
}
