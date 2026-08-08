# RestoMind Backend — Enterprise Agentic AI & RAG System Architecture Guide

## 📋 Executive Summary

This document serves as the **Single Source of Truth** for designing, integrating, and deploying the **Enterprise Agentic AI & Retrieval-Augmented Generation (RAG) Platform** for **RestoMind**.

RestoMind is an Egyptian restaurant & bakery management system powered by NestJS, MongoDB (Mongoose), AI services, and a FastAPI AI microservice for demand forecasting.

This architecture evolves pure RAG into an **Autonomous Agentic AI Engine**. The system keeps RAG as a foundational knowledge retrieval layer, while introducing an **AI Agent** capable of task planning, tool selection, multi-step data reasoning, structured recommendation generation, multi-turn state management, and **human-in-the-loop business action execution**.

The system utilizes a decoupled **AI Provider Pattern Architecture** (`AIProvider` interface) supporting 3 execution environments seamlessly selected from `.env`:

1. **Scholarship HTTP Gateway Provider (`GatewayProvider`)**: Direct HTTP Bearer client for scholarship API keys (`sbg_...`) targeting the ITI Gateway (`http://apiaccess.iti.net.eg/api/v1/student/chat` and `/student/embed`).
2. **AWS Bedrock SDK Provider (`BedrockProvider`)**: Direct AWS Bedrock Runtime client (`@aws-sdk/client-bedrock-runtime`) for standard AWS IAM keys.
3. **Standalone Local Provider (`LocalProvider`)**: Zero-network offline provider for local development and deterministic testing.

Approved Bedrock Models:

- **Primary LLM**: `amazon.nova-lite-v1:0` / `anthropic.claude-sonnet-4-6` (High-reasoning synthesis & structured recommendation generation)
- **Fast Router / Planner**: `amazon.nova-micro-v1:0` / `anthropic.claude-haiku-4-5-20251001-v1:0` (Sub-150ms intent routing & tool parameter extraction)
- **Primary Multilingual Embedding**: `us.cohere.embed-v4:0` / `amazon.titan-embed-text-v2:0` (1024-dim cross-retrieval for Arabic/English)
- **Fallback Embedding**: `amazon.titan-embed-text-v2:0`
- **Voice Assistant**: `mistral.voxtral-small-24b-2507` / `amazon.nova-2-sonic-v1:0` (Speech-to-text for kitchen staff)

---

## 🏛️ 1. End-to-End System Architecture

```
User (Web / Mobile App / Voice Input)
          │
          ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Authentication & Multi-Tenant Guard                                 │
│    - Verifies JWT Token                                                │
│    - Extracts `restaurantId` & `userId` (Guarantees 100% Tenant Isolation)│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. AI Agent Orchestrator (AssistantService)                            │
│    - Manages session lifecycle & Egyptian Arabic text normalization   │
│    - Restores multi-turn `ConversationState` (Pending Workflows)       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3. AI Provider Layer (AIProviderModule & AIProviderFactory)            │
│    - Selects provider dynamically from .env (`AI_PROVIDER_TYPE`)       │
│    - GatewayProvider (Scholarship Proxy Key sbg_...)                   │
│    - BedrockProvider (AWS Bedrock SDK)                                 │
│    - LocalProvider (Offline Standalone Development)                    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 4. Task Planner (PlannerService via AIProvider)                        │
│    - Classifies Intent (Information, Analytics, Recommendation, Action,│
│      Workflow, Conversation)                                           │
│    - Constructs Multi-Step Tool Execution Plan                         │
│    - Fallback: Egyptian Arabic Heuristic Classifier                    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 5. Tool Registry & Execution Engine (ToolExecutorService)              │
│    - Maps planned steps to registered NestJS Tool interfaces           │
│    - Validates arguments using Zod Schemas                             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 6. Execution Engine                                                    │
│    ┌──────────────────────┬──────────────────────┬───────────────────┐ │
│    │ Aggregation Tools    │ Vector Search Tool   │ Action Tools      │ │
│    │ (Sales, Inventory,   │ (Atlas $vectorSearch │ (Create Offer,    │ │
│    │  Waste, Predictions) │  knowledge_vectors)  │  Draft PO, Plan)  │ │
│    └──────────┬───────────┴──────────┬───────────┴─────────┬─────────┘ │
└───────────────┼──────────────────────┼─────────────────────┼───────────┘
                │                      │                     │
                ▼                      ▼                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ MongoDB Database (Mongoose Repositories & Atlas Vector Index)          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 7. Response & Recommendation Generator                                 │
│    - Synthesizes grounded results in Egyptian Arabic / English        │
│    - Formats structured recommendations & action cards for UI          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 8. Human Approval Guard & Action Audit Logger                          │
│    - Blocks execution of state-changing actions until user confirms    │
│    - Persists audit trails in `assistant_action_logs`                  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🔌 2. AI Provider Pattern Architecture

To ensure zero hardcoded runtime dependencies on AWS SDK or specific cloud vendors, RestoMind implements the **Provider Pattern** (`src/ai-provider/`):

```
                        [ AIProvider Interface ]
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
 [ GatewayProvider ]       [ BedrockProvider ]       [ LocalProvider ]
(Scholarship sbg_ Key)    (AWS Bedrock SDK)         (Offline Development)
```

### `AIProvider` Interface Definition (`src/ai-provider/ai-provider.interface.ts`)

```typescript
export interface GenerationOptions {
  modelId?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIProvider {
  readonly providerName: string;

  generateText(
    prompt: string,
    options?: GenerationOptions,
    messagesHistory?: ChatMessage[],
  ): Promise<string>;

  generateEmbedding(
    text: string,
    inputType?: 'search_document' | 'search_query',
  ): Promise<number[]>;
}
```

### Dynamic Factory Configuration (`src/ai-provider/ai-provider.module.ts`)

The system automatically selects the correct provider at application startup without requiring code changes:

```typescript
export const AI_PROVIDER = 'AI_PROVIDER';

@Global()
@Module({
  providers: [
    BedrockProvider,
    GatewayProvider,
    LocalProvider,
    {
      provide: AI_PROVIDER,
      useFactory: (): AIProvider => {
        const logger = new Logger('AIProviderFactory');
        const providerType = (process.env.AI_PROVIDER_TYPE || '')
          .toLowerCase()
          .trim();
        const scholarshipKey = (
          process.env.SCHOLARSHIP_API_KEY ||
          process.env.BEDROCK_GATEWAY_KEY ||
          process.env.AWS_SECRET_ACCESS_KEY ||
          process.env.AWS_ACCESS_KEY_ID ||
          ''
        ).trim();
        const gatewayUrl = (process.env.BEDROCK_GATEWAY_URL || '').trim();

        if (providerType === 'gateway') return new GatewayProvider();
        if (providerType === 'bedrock') return new BedrockProvider();
        if (providerType === 'local') return new LocalProvider();

        if (
          scholarshipKey.startsWith('sbg_') ||
          gatewayUrl ||
          scholarshipKey.length > 0
        ) {
          logger.log('Auto-detected GatewayProvider for Scholarship Proxy Key');
          return new GatewayProvider();
        }

        return new LocalProvider();
      },
    },
  ],
  exports: [AI_PROVIDER, BedrockProvider, GatewayProvider, LocalProvider],
})
export class AIProviderModule {}
```

---

## 🤖 3. Agent Layer & Multi-Step Task Planning

### Agent Orchestration Principles

1. **Centralized Agent Orchestration**: The AI Agent controls the end-to-end request lifecycle.
2. **Multi-Step Reasoning**: Complex user queries are broken down into sequential tool steps by `PlannerService`.
3. **Decoupled Execution**: Services depend **only** on `@Inject(AI_PROVIDER) private readonly aiProvider: AIProvider`.

### Intent Classification Categories

1. `Information`: Pure factual queries (recipes, menu details).
2. `Analytics`: Quantitative figures (sales totals, waste costs, expiring counts).
3. `Recommendation`: Strategic requests asking for advice/solutions to cut costs.
4. `Action`: Explicit commands to mutate data (create offer, draft PO, update plan).
5. `Workflow`: Multi-step interactive setup dialog.
6. `Conversation`: Greetings, system help, non-business Q&A.

---

## 🛠️ 4. Tool Calling Architecture & Tool Registry

### Strict Architectural Rule:

> **The AI Agent MUST NEVER access MongoDB directly.**
> All database reads, vector searches, aggregations, and business state mutations MUST be executed via strongly-typed, registered NestJS Tools wrapped in Zod parameter schemas.

### Tool Registry Summary (11 Implemented Tools)

```
                                  Agent Tool Registry
                                           │
         ┌─────────────────────────────────┼─────────────────────────────────┐
         ▼                                 ▼                                 ▼
   📊 Query Tools                    🟢 Knowledge RAG Tool             ⚡ Action Tools
 (Mongo Aggregation)                (Atlas Vector Search)             (Business Mutations)
 • getInventoryStatus()             • searchKnowledge()               • createOffer() [Approval]
 • getWasteSummary()                                                  • createPurchaseOrder() [Approval]
 • getSalesComparison()                                               • updateProductionPlan() [Approval]
 • getPredictions()                                                   • scheduleDiscount() [Approval]
 • generateExecutiveReport()                                          • sendNotification() [Approval]
```

---

## ⚙️ 5. `.env` Configuration Blueprint

Add the configuration options to your **`.env`** file at the root of `RestoMindAPI`:

```env
# ==========================================
# SCHOLARSHIP AI GATEWAY CONFIGURATION
# ==========================================
# Set your scholarship key here (starts with sbg_)
SCHOLARSHIP_API_KEY=sbg_DKoPRQLwUy6X4_sqvaQR1fSyOX_tHPjd
SBG_API_KEY=sbg_DKoPRQLwUy6X4_sqvaQR1fSyOX_tHPjd
BEDROCK_GATEWAY_URL=http://apiaccess.iti.net.eg

# AI Provider Selection: 'gateway' (scholarship proxy key), 'bedrock' (AWS SDK), 'local' (offline dev)
AI_PROVIDER_TYPE=gateway

# Exact Approved Bedrock Model Identifiers
BEDROCK_PRIMARY_LLM=amazon.nova-lite-v1:0
BEDROCK_ROUTER_LLM=amazon.nova-micro-v1:0
BEDROCK_PRIMARY_EMBEDDING=us.cohere.embed-v4:0
BEDROCK_FALLBACK_EMBEDDING=amazon.titan-embed-text-v2:0
```

---

## 🎯 6. Recommendation Engine Architecture

The **Recommendation Engine** converts aggregated data insights into structured, actionable business recommendations.

### Structured Recommendation Schema

```typescript
export interface StructuredRecommendation {
  recommendationId?: string;
  title: string; // e.g. "Create 25% Discount Offer for Expiring Stock"
  description: string; // Detailed rationale
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  estimatedSaving: number; // Estimated savings in EGP
  confidence: number; // Model confidence score (0.00 - 1.00)
  requiredTools: string[]; // e.g. ["createOffer"]
  requiresApproval: boolean; // Always true for state changes
  actionPayload: {
    toolName: string;
    arguments: Record<string, any>;
  };
}
```

---

## 🛡️ 7. Human Approval Workflow (Human-in-the-Loop)

> **NO BUSINESS ACTION EXECUTES AUTOMATICALLY.**
> The Agent can search, calculate, analyze, and recommend autonomously. Any action mutating database state (`createOffer`, `createPurchaseOrder`, `updateProductionPlan`) requires **explicit human user approval**.

1. User sends action intent (e.g. `"اعمل عرض خصم 20% على الكرواسون"`).
2. Assistant returns recommendation card with `requiresApproval: true` and pending action payload.
3. User approves action via UI button calling `POST /assistant/approve-action`.
4. `ApprovalService` verifies approval token and invokes `ToolExecutorService.executeApprovedAction()`.

---

## 🗄️ 8. Complete MongoDB Schemas Blueprint

### 1. `assistant_action_logs` Schema (`src/DB/Models/assistant-action-log.model.ts`)

```typescript
@Schema({ timestamps: true })
export class AssistantActionLog {
  @Prop({
    type: Types.ObjectId,
    ref: 'Restaurant',
    required: true,
    index: true,
  })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  sessionId!: string;

  @Prop({ type: String, required: true })
  toolName!: string;

  @Prop({ type: Object, required: true })
  arguments!: Record<string, any>;

  @Prop({
    type: String,
    enum: ['SUCCESS', 'FAILED', 'REJECTED_BY_USER', 'PENDING_APPROVAL'],
    required: true,
  })
  executionStatus!: string;

  @Prop({ type: Number, default: 0 })
  durationMs!: number;

  @Prop({ type: String, required: true })
  modelUsed!: string;

  @Prop({ type: Object, default: null })
  executionResult?: Record<string, any>;

  @Prop({ type: String, default: null })
  errorMessage?: string;
}
```

### 2. `knowledge_vectors` Schema (`src/DB/Models/knowledge-vector.model.ts`)

```typescript
@Schema({ timestamps: true })
export class KnowledgeVector {
  @Prop({
    type: Types.ObjectId,
    ref: 'Restaurant',
    required: true,
    index: true,
  })
  restaurantId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: [
      'product',
      'recipe',
      'offer',
      'waste_report',
      'recommendation',
      'weekly_snapshot',
    ],
  })
  entityType!: string;

  @Prop({ type: Types.ObjectId, required: true })
  entityId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  textContent!: string;

  @Prop({ type: [Number], required: true })
  embedding!: number[]; // 1024 dimensions (us.cohere.embed-v4:0)

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, any>;

  @Prop({ type: Boolean, default: false, index: true })
  isDeleted!: boolean;
}
```

---

## 🏗️ 9. Complete NestJS Folder Structure

```
src/
├── ai-provider/                             # Decoupled AI Provider Module
│   ├── ai-provider.module.ts                # Dynamic Provider Factory ('AI_PROVIDER')
│   ├── ai-provider.interface.ts             # AIProvider Interface Contract
│   └── providers/
│       ├── gateway.provider.ts              # Scholarship Proxy Key HTTP Client (sbg_...)
│       ├── bedrock.provider.ts              # Direct AWS Bedrock SDK Client
│       └── local.provider.ts                # Standalone Offline Local Development Provider
│
├── assistant/                               # Enterprise Agentic AI Module
│   ├── assistant.module.ts
│   ├── assistant.controller.ts
│   ├── services/
│   │   ├── assistant.service.ts             # Main Agent Orchestrator
│   │   ├── planner.service.ts               # Multi-Step Task Planner via AIProvider
│   │   ├── tool-executor.service.ts         # Tool Registry & Execution Engine
│   │   ├── recommendation.service.ts       # Structured Recommendation Generator
│   │   ├── conversation-state.service.ts    # Multi-turn Workflow State Manager
│   │   ├── approval.service.ts              # Human-in-the-loop Guard & Audit Logger
│   │   └── arabic-normalizer.service.ts     # Egyptian Arabic Text Normalization
│   │
│   ├── tools/                               # Registered Agent Tools
│   │   ├── tool-registry.service.ts         # Central Tool Registry
│   │   ├── query-tools/                     # Mongo Aggregation Read Tools
│   │   ├── rag-tools/                       # Atlas Vector Search RAG Tool
│   │   └── action-tools/                    # Business Mutation Tools (Approval Required)
│   │
│   ├── dto/
│   └── interfaces/
│
├── vector-store/                            # Vector Management Module
│   ├── vector-store.module.ts
│   ├── vector-store.service.ts              # MongoDB Atlas Vector Search & Hybrid Search
│   ├── bedrock-embedding.service.ts         # Embedding Bridge via AIProvider
│   ├── listeners/
│   │   └── entity-change.listener.ts        # Auto-embeds products/offers on change
│   └── jobs/
│       └── weekly-snapshot.job.ts           # Executive Snapshot Cron Job
```

---

## 🛡️ 10. Security & Hardening Architecture

RestoMind implements defensive security boundaries around its AI Assistant and RAG pipeline to mitigate OWASP LLM Application Security risks:

### 1. Multi-Tenant Isolation
- **Server-Side Enforcement**: `restaurantId` and `userId` are extracted exclusively from authenticated JWT payloads (`authUser`) in `AssistantController`.
- **Query Scoping**: All database reads, Mongo aggregations, and Atlas `$vectorSearch` pipeline stages strictly enforce `restaurantId: { $eq: restaurantId }`. The LLM is never permitted to choose, override, or supply tenant identifiers.

### 2. Prompt Injection & Trust Boundary Defense
- **XML Data Boundaries**: Grounded tool results and retrieved RAG matches are enclosed in `<UNTRUSTED_GROUNDED_DATA>` and `<UNTRUSTED_RECOMMENDATIONS>` XML boundary tags.
- **System Directives**: System prompts explicitly instruct the LLM to treat content inside `<UNTRUSTED_...>` tags strictly as literal data to summarize or process, prohibiting the execution of embedded instructions or rule overrides.

### 3. Action Tool Approval Enforcement (Excessive Agency Guard)
- **Mandatory Server-Side Guard**: `ToolExecutorService` unconditionally blocks immediate execution of state-changing action tools (`createOffer`, `createPurchaseOrder`, `updateProductionPlan`, `scheduleDiscount`, `sendNotification`).
- **Approval Workflow**: Unapproved action calls return `status: PENDING_HUMAN_APPROVAL` and `executed: false`, requiring explicit manager confirmation via `/assistant/approve-action`.

### 4. Input & Execution Bounded Consumption (DoS Protection)
- **Input Cap**: Incoming user message prompts are validated and truncated to a maximum of 2,000 characters.
- **Plan Step Cap**: `PlannerService` caps execution plans to a maximum of 5 tool steps.
- **Tool Execution Cap**: `ToolExecutorService` caps total tool calls to a maximum of 5 executions per request.
- **Vector Retrieval Cap**: `KnowledgeSearchTool` and `VectorStoreService` cap RAG document retrieval limits to a maximum of 10 matches.

### 5. System Prompt & Secret Leakage Protection
- **Prompt Protection**: System prompts instruct the model never to disclose underlying instructions, hidden system policies, or internal credentials.
- **Output Sanitization**: `AssistantService.sanitizeOutputText` and `ToolRegistryService` sanitize response strings and error logs to redact internal secret strings, API keys (`sbg_...`), Bearer tokens, and database connection strings.

### 6. Audit Logging
- **Audit Logging**: Tool invocations, execution timings, and blocked human approval actions format structured logs tagged with `[AUDIT]` without exposing secret credentials.
