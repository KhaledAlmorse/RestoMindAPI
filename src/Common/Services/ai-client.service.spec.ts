import { Test, TestingModule } from '@nestjs/testing';
import { AiClientService } from './ai-client.service';

describe('AiClientService', () => {
  let service: AiClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiClientService],
    }).compile();
    service = module.get(AiClientService);
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any) => {
      if (typeof fn === 'function') fn();
      return 0 as any;
    }) as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns ok with the parsed body on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ predictedOrders: 42 }),
    }) as any;

    const result = await service.post<{ predictedOrders: number }>('/x', {});
    expect(result).toEqual({ ok: true, data: { predictedOrders: 42 } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a 4xx and reports it as client_error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not_found', hint: 'Known SKUs: A, B' }),
    }) as any;

    const result = await service.post('/x', {});
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      kind: 'client_error',
      status: 404,
    });
    expect((result as any).body).toEqual({
      error: 'not_found',
      hint: 'Known SKUs: A, B',
    });
  });

  it('retries a 5xx up to the retry limit then reports unavailable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as any;

    const result = await service.post('/x', {}, { retries: 3 });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      ok: false,
      kind: 'unavailable',
      status: 503,
    });
  });

  it('retries a network failure then reports unavailable', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as any;

    const result = await service.post('/x', {}, { retries: 3 });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ ok: false, kind: 'unavailable' });
    expect((result as any).message).toContain('ECONNREFUSED');
  });

  it('succeeds on a retry after a transient failure', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ v: 1 }),
      }) as any;

    const result = await service.post<{ v: number }>('/x', {});
    expect(result).toEqual({ ok: true, data: { v: 1 } });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('builds the URL from AI_SERVICE_URL without a double slash', async () => {
    process.env.AI_SERVICE_URL = 'http://ai.internal:8200/';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as any;

    await service.post('/integration/restomind/predict', {});
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'http://ai.internal:8200/integration/restomind/predict',
    );
    delete process.env.AI_SERVICE_URL;
  });

  it('attaches the API key header when AI_API_KEY is configured', async () => {
    process.env.AI_API_KEY = 's3cret';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as any;

    await service.post('/integration/restomind/predict', {});

    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(init.headers['X-API-Key']).toBe('s3cret');
    delete process.env.AI_API_KEY;
  });

  it('falls back to AI_SHARED_SECRET for the X-API-Key header', async () => {
    process.env.AI_SHARED_SECRET = 'legacy-secret';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as any;

    await service.post('/integration/restomind/predict', {});

    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(init.headers['X-API-Key']).toBe('legacy-secret');
    delete process.env.AI_SHARED_SECRET;
  });

  it('classifies a 429 as rate_limited, does NOT retry, and carries Retry-After', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '42' }),
      json: async () => ({ error: 'rate_limited' }),
    }) as any;

    const result = await service.post('/marketing/publish', {}, { retries: 3 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      kind: 'rate_limited',
      status: 429,
      retryAfter: 42,
    });
  });

  it('avoids retrying a rate limit even when Retry-After is absent', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers(),
      json: async () => ({ error: 'rate_limited' }),
    }) as any;

    const result = await service.post('/x', {}, { retries: 3 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, kind: 'rate_limited' });
    expect((result as any).retryAfter).toBeUndefined();
  });
});
