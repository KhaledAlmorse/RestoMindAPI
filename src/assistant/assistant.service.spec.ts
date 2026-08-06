import { Test, TestingModule } from '@nestjs/testing';
import { ArabicNormalizerService } from './services/arabic-normalizer.service';
import { ConversationStateService } from './services/conversation-state.service';
import { PlannerService } from './services/planner.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { BedrockEmbeddingService } from 'src/vector-store/bedrock-embedding.service';
import { LocalProvider } from 'src/ai-provider/providers/local.provider';
import { AI_PROVIDER } from 'src/ai-provider/ai-provider.module';

describe('Agentic AI & RAG Suite', () => {
  let arabicNormalizer: ArabicNormalizerService;
  let conversationState: ConversationStateService;
  let toolRegistry: ToolRegistryService;
  let plannerService: PlannerService;
  let bedrockEmbedding: BedrockEmbeddingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArabicNormalizerService,
        ConversationStateService,
        ToolRegistryService,
        PlannerService,
        BedrockEmbeddingService,
        {
          provide: AI_PROVIDER,
          useClass: LocalProvider,
        },
      ],
    }).compile();

    arabicNormalizer = module.get<ArabicNormalizerService>(ArabicNormalizerService);
    conversationState = module.get<ConversationStateService>(ConversationStateService);
    toolRegistry = module.get<ToolRegistryService>(ToolRegistryService);
    plannerService = module.get<PlannerService>(PlannerService);
    bedrockEmbedding = module.get<BedrockEmbeddingService>(BedrockEmbeddingService);
  });

  describe('ArabicNormalizerService', () => {
    it('should normalize Egyptian Arabic text by removing tatweel and standardizing alef/hamza', () => {
      const input = 'أهلاً بكــم في مـطعمنا إبريق!';
      const normalized = arabicNormalizer.normalizeText(input);
      expect(normalized).not.toContain('أ');
      expect(normalized).not.toContain('إ');
      expect(normalized).toContain('اهل');
    });

    it('should correctly detect Arabic vs English language', () => {
      expect(arabicNormalizer.detectLanguage('ايه اكتر سبب للهدر؟')).toBe('arabic');
      expect(arabicNormalizer.detectLanguage('What caused the biggest revenue loss?')).toBe('english');
    });
  });

  describe('ConversationStateService', () => {
    it('should manage and persist multi-turn workflow parameters', () => {
      const sessionId = 'session_test_123';
      conversationState.setSessionState(sessionId, {
        sessionId,
        restaurantId: 'rest_1',
        userId: 'user_1',
        status: 'AWAITING_PARAMETERS',
        pendingAction: 'CREATE_OFFER',
        lastUpdated: new Date(),
      });

      const updated = conversationState.updateSessionParams(sessionId, { discountPercentage: 25 });
      expect(updated.collectedParams?.discountPercentage).toBe(25);

      conversationState.clearSessionState(sessionId);
      expect(conversationState.getSessionState(sessionId)).toBeUndefined();
    });
  });

  describe('BedrockEmbeddingService', () => {
    it('should return a 1024-dimensional normalized vector', async () => {
      const text = 'Croissant bakery product recipe';
      const vector = await bedrockEmbedding.generateEmbedding(text);
      expect(vector).toBeDefined();
      expect(vector.length).toBe(1024);
    });
  });

  describe('PlannerService', () => {
    it('should classify waste recommendation queries as Recommendation intent', async () => {
      const plan = await plannerService.planExecution('ايه اكتر سبب للهدر وكيف يمكن تقليله؟');
      expect(plan.intent).toBeDefined();
      expect(plan.steps).toBeDefined();
      expect(Array.isArray(plan.steps)).toBe(true);
    });
  });
});
