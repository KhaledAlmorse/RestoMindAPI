import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { AiCallResult } from '../Types/ai.types';

const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface AiCallOptions {
  retries?: number;
  timeoutMs?: number;
}

/**
 * The single owner of HTTP traffic to the forecasting microservice.
 *
 * Before this existed, four call sites each hand-rolled retry logic with
 * different retry counts and timeouts, and collapsed every failure — including
 * a 404 carrying a useful hint — into a generic 503. This centralises the
 * policy and, critically, separates "we sent something wrong" from "the service
 * is down", because only the second one justifies a fallback.
 */
@Injectable()
export class AiClientService implements OnModuleInit {
  private readonly logger = new Logger(AiClientService.name);

  /**
   * Boot-time guard for the single most damaging misconfiguration on this
   * integration: the AI service is started WITH a shared secret and NestJS
   * without one. Every `/integration/restomind/*` call then returns 401, which
   * the client classifies as `client_error` and never retries, so forecasting
   * silently degrades to the naive fallback while every endpoint still answers
   * HTTP 200.
   *
   * Deliberately a warning, not a throw: an unsecured local dev setup (no
   * secret on either side) is legitimate and must still boot.
   */
  onModuleInit(): void {
    if (!process.env.AI_SHARED_SECRET) {
      this.logger.warn(
        `AI_SHARED_SECRET is not set. Requests to ${this.baseUrl} will be sent WITHOUT the ` +
          `X-RestoMind-Key header — if that AI service enforces a shared secret, every call ` +
          `will fail with HTTP 401, will NOT be retried, and every prediction will silently ` +
          `fall back. This is expected only for an unsecured local development AI service.`,
      );
    }
  }

  get baseUrl(): string {
    return (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8200').replace(
      /\/$/,
      '',
    );
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async post<T>(
    path: string,
    body: unknown,
    opts: AiCallOptions = {},
  ): Promise<AiCallResult<T>> {
    return this.request<T>('POST', path, body, opts);
  }

  async get<T>(
    path: string,
    opts: AiCallOptions = {},
  ): Promise<AiCallResult<T>> {
    return this.request<T>('GET', path, undefined, opts);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    opts: AiCallOptions,
  ): Promise<AiCallResult<T>> {
    const retries = opts.retries ?? DEFAULT_RETRIES;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const url = this.url(path);

    let lastMessage = 'AI service unreachable';
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.AI_SHARED_SECRET
              ? { 'X-RestoMind-Key': process.env.AI_SHARED_SECRET }
              : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          return { ok: true, data: (await response.json()) as T };
        }

        lastStatus = response.status;
        const parsed = await response.json().catch(() => undefined);

        // A 4xx is our mistake. Retrying cannot fix it and falling back would
        // hide it — surface it immediately, with the service's own hint.
        if (response.status >= 400 && response.status < 500) {
          this.logger.warn(
            `AI ${method} ${path} rejected with HTTP ${response.status}: ${JSON.stringify(parsed)}`,
          );
          return {
            ok: false,
            kind: 'client_error',
            status: response.status,
            message:
              parsed?.detail ||
              parsed?.message ||
              `AI service rejected the request (HTTP ${response.status})`,
            body: parsed,
          };
        }

        lastMessage = `HTTP ${response.status}`;
        this.logger.warn(
          `AI ${method} ${path} attempt ${attempt}/${retries} returned HTTP ${response.status}`,
        );
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastMessage =
          err?.name === 'AbortError'
            ? `timed out after ${timeoutMs}ms`
            : String(err?.message || err);
        this.logger.warn(
          `AI ${method} ${path} attempt ${attempt}/${retries} failed: ${lastMessage}`,
        );
      }

      if (attempt < retries) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)),
        );
      }
    }

    return {
      ok: false,
      kind: 'unavailable',
      status: lastStatus,
      message: lastMessage,
    };
  }
}
