import { Test, TestingModule } from '@nestjs/testing';
import {
  AiIngestService,
  INGEST_CHUNK_SIZE,
  INGEST_TIMEOUT_MS,
} from './ai-ingest.service';
import { AiClientService } from 'src/Common/Services/ai-client.service';

describe('AiIngestService', () => {
  let service: AiIngestService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiIngestService, AiClientService],
    }).compile();

    service = module.get<AiIngestService>(AiIngestService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('ingest', () => {
    it('should return success true when AI endpoint returns 200 OK', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'accepted' }),
      } as any);

      const payload = {
        restaurantId: '665f0a1b2c3d4e5f00000001',
        records: [{ date: '2026-07-01', productId: 'p1', salesQty: 10 }],
        products: [{ productId: 'p1', title: 'Croissant', category: 'Pastry' }],
      };

      const result = await service.ingest(payload, 1);
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
    });

    it('should retry up to maxRetries on failure and return success false when exhausted', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('Connection refused'));

      const payload = {
        restaurantId: '665f0a1b2c3d4e5f00000001',
        records: [{ date: '2026-07-01', productId: 'p1', salesQty: 10 }],
        products: [{ productId: 'p1', title: 'Croissant', category: 'Pastry' }],
      };

      const result = await service.ingest(payload, 3);
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.error).toContain('Connection refused');
    });

    it('sends a generous timeout, not the client default sized for one forecast', async () => {
      const post = jest
        .spyOn(AiClientService.prototype, 'post')
        .mockResolvedValue({ ok: true, data: {} } as any);

      await service.ingest(
        {
          restaurantId: '665f0a1b2c3d4e5f00000001',
          records: [{ date: '2026-07-01', productId: 'p1', salesQty: 10 }],
          products: [{ productId: 'p1', title: 'Croissant' }],
        },
        1,
      );

      expect(post).toHaveBeenCalledWith(
        '/integration/restomind/ingest',
        expect.anything(),
        expect.objectContaining({ timeoutMs: INGEST_TIMEOUT_MS }),
      );
      post.mockRestore();
    });

    it('splits a large history into chunks, repeating the product list', async () => {
      const post = jest
        .spyOn(AiClientService.prototype, 'post')
        .mockResolvedValue({ ok: true, data: {} } as any);

      const records = Array.from(
        { length: INGEST_CHUNK_SIZE * 2 + 5 },
        (_, i) => ({
          date: '2026-07-01',
          productId: `p${i}`,
          salesQty: 1,
        }),
      );
      const products = [{ productId: 'p1', title: 'Croissant' }];

      const result = await service.ingest(
        { restaurantId: '665f0a1b2c3d4e5f00000001', records, products },
        1,
      );

      expect(result.success).toBe(true);
      expect(post).toHaveBeenCalledTimes(3);

      const sent = post.mock.calls.map((c) => c[1] as any);
      expect(sent.map((b) => b.records.length)).toEqual([
        INGEST_CHUNK_SIZE,
        INGEST_CHUNK_SIZE,
        5,
      ]);
      // Every chunk carries the catalogue: the service registers products from
      // whichever chunk reaches it first.
      for (const body of sent) {
        expect(body.products).toEqual(products);
      }
      // No row is dropped or duplicated across the split.
      expect(sent.flatMap((b) => b.records)).toEqual(records);

      post.mockRestore();
    });

    it('stops at the first failed chunk and reports it', async () => {
      const post = jest
        .spyOn(AiClientService.prototype, 'post')
        .mockResolvedValueOnce({ ok: true, data: {} } as any)
        .mockResolvedValueOnce({
          ok: false,
          kind: 'unavailable',
          message: 'AI down',
        } as any);

      const records = Array.from({ length: INGEST_CHUNK_SIZE * 3 }, () => ({
        date: '2026-07-01',
        productId: 'p1',
        salesQty: 1,
      }));

      const result = await service.ingest(
        {
          restaurantId: '665f0a1b2c3d4e5f00000001',
          records,
          products: [{ productId: 'p1', title: 'Croissant' }],
        },
        1,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('AI down');
      // Third chunk is never attempted.
      expect(post).toHaveBeenCalledTimes(2);
      post.mockRestore();
    });

    it('still calls the service when there are no records, to register products', async () => {
      const post = jest
        .spyOn(AiClientService.prototype, 'post')
        .mockResolvedValue({ ok: true, data: {} } as any);

      const result = await service.ingest(
        {
          restaurantId: '665f0a1b2c3d4e5f00000001',
          records: [],
          products: [{ productId: 'p1', title: 'Croissant' }],
        },
        1,
      );

      expect(result.success).toBe(true);
      expect(post).toHaveBeenCalledTimes(1);
      expect((post.mock.calls[0][1] as any).records).toEqual([]);
      post.mockRestore();
    });
  });
});
