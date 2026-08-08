import { Test, TestingModule } from '@nestjs/testing';
import { AssistantService } from './services/assistant.service';
import { ArabicNormalizerService } from './services/arabic-normalizer.service';
import {
  ConversationStateService,
  SESSION_STATE_TTL_MS,
} from './services/conversation-state.service';
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

    // Fake timers rather than a back-dated `lastUpdated`: setSessionState
    // stamps `lastUpdated` itself, so only advancing the clock exercises the
    // real expiry path.
    it('expires state past the TTL instead of resuming a stale workflow', () => {
      jest.useFakeTimers();
      try {
        const sessionId = 'session_stale';
        conversationState.setSessionState(sessionId, {
          sessionId,
          restaurantId: 'rest_1',
          userId: 'user_1',
          status: 'AWAITING_PARAMETERS',
          pendingAction: 'CREATE_OFFER',
          collectedParams: { discountPercentage: 25 },
          lastUpdated: new Date(),
        });

        jest.advanceTimersByTime(SESSION_STATE_TTL_MS + 1000);

        // `lastUpdated` was written but never read, so an abandoned "create
        // offer" flow stayed resumable forever against changed inventory.
        expect(conversationState.getSessionState(sessionId)).toBeUndefined();

        const restarted = conversationState.updateSessionParams(sessionId, { daysDuration: 3 });
        expect(restarted.collectedParams?.discountPercentage).toBeUndefined();
        expect(restarted.collectedParams?.daysDuration).toBe(3);
      } finally {
        jest.useRealTimers();
      }
    });

    it('keeps state that is still inside the TTL', () => {
      jest.useFakeTimers();
      try {
        const sessionId = 'session_fresh';
        conversationState.setSessionState(sessionId, {
          sessionId,
          restaurantId: 'rest_1',
          userId: 'user_1',
          status: 'AWAITING_PARAMETERS',
          lastUpdated: new Date(),
        });

        jest.advanceTimersByTime(SESSION_STATE_TTL_MS - 60_000);

        expect(conversationState.getSessionState(sessionId)).toBeDefined();
      } finally {
        jest.useRealTimers();
      }
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

    it('sends prior turns to the model so follow-ups resolve against context', async () => {
      const generateText = jest.fn().mockResolvedValue(
        JSON.stringify({
          intent: 'Analytics',
          explanation: 'resolved follow-up',
          steps: [{ toolName: 'getSalesComparison', arguments: { windowDays: 7 }, reason: 'r' }],
        }),
      );
      const planner = new PlannerService(toolRegistry, {
        providerName: 'StubProvider',
        generateText,
        generateEmbedding: jest.fn(),
      } as any);

      await planner.planExecution('وكمان الاسبوع اللي فات؟', undefined, [
        { role: 'user', content: 'ايه مبيعات الاسبوع ده؟' },
        { role: 'assistant', content: 'مبيعات الاسبوع 14,250 جنيه.' },
      ]);

      // Without this the planner classified every follow-up as a first message.
      const prompt = generateText.mock.calls[0][0] as string;
      expect(prompt).toContain('Conversation So Far');
      expect(prompt).toContain('ايه مبيعات الاسبوع ده؟');
      expect(prompt).toContain('وكمان الاسبوع اللي فات؟');
    });

    // The heuristic planner is what runs whenever the LLM is unreachable, so
    // these are the paths a misconfigured gateway leaves users on.
    describe('fallback heuristic (LLM unavailable)', () => {
      it.each([
        ['suggest recommendations', 'english'],
        ['any recommendations for me?', 'english plural'],
        ['اقترح توصيات', 'arabic'],
        ['عايز نصيحة', 'arabic taa-marbuta'],
      ])('classifies "%s" (%s) as Recommendation, not a knowledge lookup', async (prompt) => {
        const plan = await plannerService.planExecution(prompt);

        expect(plan.intent).toBe('Recommendation');
        // Recommendation cards are built from these tool results; a bare
        // searchKnowledge step produced "no matches found" instead.
        expect(plan.steps.map((s) => s.toolName)).toEqual(
          expect.arrayContaining(['getInventoryStatus', 'getWasteSummary']),
        );
        expect(plan.steps.map((s) => s.toolName)).not.toContain('searchKnowledge');
      });

      it('routes a recipe question to the exact-match recipe tool, not RAG', async () => {
        const plan = await plannerService.planExecution('what is in the sourdough recipe?');
        expect(plan.steps.map((s) => s.toolName)).toContain('getRecipeIngredients');
      });
    });

    it('omits the history block entirely on the first message', async () => {
      const generateText = jest.fn().mockResolvedValue(
        JSON.stringify({ intent: 'Conversation', explanation: 'greeting', steps: [] }),
      );
      const planner = new PlannerService(toolRegistry, {
        providerName: 'StubProvider',
        generateText,
        generateEmbedding: jest.fn(),
      } as any);

      await planner.planExecution('اهلا');

      expect(generateText.mock.calls[0][0]).not.toContain('Conversation So Far');
    });
  });

  describe('Recipe Ingredients & Formatting Tests (TEST 1 - TEST 5)', () => {
    it('TEST 1: should format exact 3 ingredients and quantities into Markdown table', async () => {
      const toolResults = [
        {
          toolName: 'getRecipeIngredients',
          result: {
            productName: 'Croissant',
            foundProduct: true,
            hasRecipe: true,
            ingredients: [
              { name: 'Flour', quantity: 10, unit: 'kg' },
              { name: 'Butter', quantity: 2, unit: 'kg' },
              { name: 'Sugar', quantity: 1, unit: 'kg' },
            ],
          },
        },
      ];

      const res = await (AssistantService.prototype as any).synthesizeResponse(
        'ما هي مكونات الكرواسون؟',
        'arabic',
        'Information',
        toolResults,
        [],
        [],
      );

      expect(res.answer).toContain('### المكونات');
      expect(res.answer).toContain('| Flour | 10 | kg |');
      expect(res.answer).toContain('| Butter | 2 | kg |');
      expect(res.answer).toContain('| Sugar | 1 | kg |');
      expect(res.answer).not.toContain('طريقة التحضير');
    });

    it('TEST 2 & TEST 5: should mark missing quantity as "غير متوفرة" without inventing numbers', async () => {
      const toolResults = [
        {
          toolName: 'getRecipeIngredients',
          result: {
            productName: 'Special Dish',
            foundProduct: true,
            hasRecipe: true,
            ingredients: [
              { name: 'Secret Sauce', quantity: null, unit: null },
            ],
          },
        },
      ];

      const res = await (AssistantService.prototype as any).synthesizeResponse(
        'ما هي مكونات المنتج؟',
        'arabic',
        'Information',
        toolResults,
        [],
        [],
      );

      expect(res.answer).toContain('| Secret Sauce | غير متوفرة | غير متوفرة |');
    });

    it('TEST 3: should NOT generate preparation steps when database contains ingredients only', async () => {
      const toolResults = [
        {
          toolName: 'getRecipeIngredients',
          result: {
            productName: 'Basbousa',
            foundProduct: true,
            hasRecipe: true,
            ingredients: [{ name: 'Semolina', quantity: 1, unit: 'kg' }],
          },
        },
      ];

      const res = await (AssistantService.prototype as any).synthesizeResponse(
        'ما هي مكونات البسبوسة وخطوات التحضير؟',
        'arabic',
        'Information',
        toolResults,
        [],
        [],
      );

      expect(res.answer).toContain('### المكونات');
      expect(res.answer).not.toContain('طريقة التحضير');
      expect(res.answer).not.toContain('درجة حرارة الفرن');
    });

    it('TEST 4: should return explicit unavailable message when database has no recipe information', async () => {
      const toolResults = [
        {
          toolName: 'getRecipeIngredients',
          result: {
            productName: 'Unknown Item',
            foundProduct: false,
            hasRecipe: false,
            ingredients: [],
          },
        },
      ];

      const res = await (AssistantService.prototype as any).synthesizeResponse(
        'ما هي مكونات المنتج غير المعروف؟',
        'arabic',
        'Information',
        toolResults,
        [],
        [],
      );

      expect(res.answer).toBe('لا توجد معلومات مسجلة عن مكونات هذا المنتج في البيانات المتاحة.');
    });
  });

  describe('Empty Data Fallback Handling (Zero Fabrication)', () => {
    it('should return explicit unavailable message when getPredictions has empty items', async () => {
      const toolResults = [
        {
          toolName: 'getPredictions',
          result: { horizon: '7_days', items: [] },
        },
      ];

      const res = await (AssistantService.prototype as any).synthesizeResponse(
        'ما هي توقعات الطلب؟',
        'arabic',
        'Analytics',
        toolResults,
        [],
        [],
      );

      expect(res).toContain('لا توجد بيانات توقعات متوفرة للفترة القادمة');
      expect(res).not.toContain('150 طلب');
      expect(res).not.toContain('89%');
    });

    it('should return explicit unavailable message when generateExecutiveReport has empty history', async () => {
      const toolResults = [
        {
          toolName: 'generateExecutiveReport',
          result: { reportPeriod: 'last_week', history: [] },
        },
      ];

      const res = await (AssistantService.prototype as any).synthesizeResponse(
        'ما هو التقرير التنفيذي؟',
        'arabic',
        'Analytics',
        toolResults,
        [],
        [],
      );

      expect(res).toContain('لا توجد بيانات تقرير تنفيذي متوفرة للفترة الماضية');
      expect(res).not.toContain('14,250');
      expect(res).not.toContain('كرواسون بالزبده');
      expect(res).not.toContain('92%');
    });
  });

  describe('AssistantService Security Boundaries', () => {
    it('should sanitize output text and redact secret keys', () => {
      const rawText = 'API key is sbg_123456789 and url is mongodb+srv://admin:pass@cluster.mongodb.net';
      const sanitized = (AssistantService.prototype as any).sanitizeOutputText(rawText);
      expect(sanitized).not.toContain('sbg_123456789');
      expect(sanitized).not.toContain('mongodb+srv://admin:pass');
      expect(sanitized).toContain('[REDACTED_API_KEY]');
      expect(sanitized).toContain('[REDACTED_DB_URL]');
    });
  });
});
