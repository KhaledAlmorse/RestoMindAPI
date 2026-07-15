import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class performanceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const start = Date.now();
    console.log(`Request Started At ${start}`);

    return next.handle().pipe(
      tap(() => {
        const end = Date.now();
        const duration = end - start;
        console.log(`Request finished At ${end} and took ${duration}ms`);
      }),
    );
  }
}
