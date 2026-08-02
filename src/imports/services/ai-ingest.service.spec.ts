import { Test, TestingModule } from '@nestjs/testing';
import { AiIngestService } from './ai-ingest.service';
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
  });
});
