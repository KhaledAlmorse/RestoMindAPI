# RestoMind Backend — Enterprise Agentic AI & RAG System Architecture Guide

## 📋 Executive Summary

This document serves as the **Single Source of Truth** for designing, integrating, and deploying the **Enterprise Agentic AI & Retrieval-Augmented Generation (RAG) Platform** for **RestoMind**.

RestoMind is an Egyptian restaurant & bakery management system powered by NestJS, MongoDB (Mongoose), AWS Bedrock AI services, and a FastAPI AI microservice for demand forecasting.

This architecture evolves pure RAG into an **Autonomous Agentic AI Engine**. The system keeps RAG as a foundational knowledge retrieval layer, while introducing an **AI Agent** capable of task planning, tool selection, multi-step data reasoning, structured recommendation generation, multi-turn state management, and **human-in-the-loop business action execution**.

All generative AI models and embeddings are hosted natively on **AWS Bedrock (Region: `us-east-1`)**:
- **Primary LLM**: `anthropic.claude-sonnet-4-6` (High-reasoning synthesis & structured recommendation generation)
- **Fast Router / Planner**: `anthropic.claude-haiku-4-5-20251001-v1:0` (Sub-150ms intent routing & tool parameter extraction)
- **Primary Multilingual Embedding**: `us.cohere.embed-v4:0` (1024-dim cross-retrieval for Arabic/English)
- **Fallback Embedding**: `amazon.titan-embed-text-v2:0:8k` / `amazon.nova-2-multimodal-embeddings-v1:0`
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
│ 2. AI Agent Orchestrator                                               │
│    - Manages session lifecycle & Egyptian Arabic text normalization   │
│    - Restores multi-turn `ConversationState` (Pending Workflows)       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3. Task Planner (Claude Haiku 4.5: anthropic.claude-haiku-4-5-20251001-v1:0) │
│    - Classifies Intent (Information, Analytics, Recommendation, Action)│
│    - Constructs Multi-Step Tool Execution Plan                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 4. Tool Registry & Selector                                            │
│    - Maps planned steps to registered NestJS Tool interfaces           │
│    - Validates arguments using strict Zod Schemas                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 5. Execution Engine                                                    │
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
│ 6. Response & Recommendation Generator (Claude Sonnet 4.6)             │
│    - Model: anthropic.claude-sonnet-4-6                                │
│    - Synthesizes grounded results in Egyptian Arabic / English        │
│    - Formats structured recommendations & action cards for UI          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 7. Human Approval Guard & Action Audit Logger                          │
│    - Blocks execution of state-changing actions until user confirms    │
│    - Persists audit trails in `assistant_action_logs`                  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🤖 2. Agent Layer & Multi-Step Task Planning

### Agent Orchestration Principles
1. **Centralized Agent Orchestration**: The AI Agent controls the end-to-end user request lifecycle. It manages state, plans, calls tools, handles failures, and presents results.
2. **Multi-Step Reasoning**: Complex user requests are decomposed into sequential tool executions by the `PlannerService`.

### Multi-Step Execution Example

**User Prompt**: *"Give me recommendations to reduce waste this week."*

#### Task Planner Execution Plan:
```
           ┌────────────────────────────────────────────────────────┐
           │ Step 1: Execute `getWasteSummary({ period: '7_days' })`│
           └───────────────────────────┬────────────────────────────┘
                                       │
                                       ▼
           ┌────────────────────────────────────────────────────────┐
           │ Step 2: Execute `getInventoryStatus({ filter: 'expiring' })`│
           └───────────────────────────┬────────────────────────────┘
                                       │
                                       ▼
           ┌────────────────────────────────────────────────────────┐
           │ Step 3: Execute `getSalesComparison({ windowDays: 7 })`│
           └───────────────────────────┬────────────────────────────┘
                                       │
                                       ▼
           ┌────────────────────────────────────────────────────────┐
           │ Step 4: Execute `getPredictions({ horizon: '7_days' })`│
           └───────────────────────────┬────────────────────────────┘
                                       │
                                       ▼
           ┌────────────────────────────────────────────────────────┐
           │ Step 5: Pass fused context to `RecommendationService`  │
           │         to generate structured actionable cards.        │
           └────────────────────────────────────────────────────────┘
```

---

## 🛠️ 3. Tool Calling Architecture & Tool Registry

### Strict Architectural Rule:
> **The AI Agent MUST NEVER access MongoDB directly.**
> All database reads, vector searches, aggregations, and business state mutations MUST be executed via strongly-typed, registered NestJS Tools wrapped in Zod parameter schemas.

### Tool Classification Registry

```
                                  Agent Tool Registry
                                           │
         ┌─────────────────────────────────┼─────────────────────────────────┐
         ▼                                 ▼                                 ▼
   📊 Query Tools                    🟢 Knowledge RAG Tool             ⚡ Action Tools
 (Mongo Aggregation)                (Atlas Vector Search)             (Business Mutations)
 • getInventoryStatus()             • searchKnowledge()               • createOffer()
 • getWasteSummary()                                                  • createPurchaseOrder()
 • getSalesComparison()                                               • updateProductionPlan()
 • getPredictions()                                                   • scheduleDiscount()
 • generateExecutiveReport()                                          • sendNotification()
```

---

## ☁️ 4. AWS Bedrock Approved Model Mapping

Below is the exact mapping of your **Approved AWS Bedrock Models** (Region: `us-east-1`) to RestoMind backend roles:

| System Role | Model Identifier (Exact String) | Provider | Purpose |
| :--- | :--- | :--- | :--- |
| **Primary LLM (RAG & Synthesis)** | `anthropic.claude-sonnet-4-6` | Anthropic | Multi-step reasoning, structured recommendation generation, Arabic/English response synthesis. |
| **Router & Task Planner** | `anthropic.claude-haiku-4-5-20251001-v1:0` | Anthropic | Sub-150ms intent classification (6 categories) and Zod tool parameter extraction. |
| **Primary Vector Embedding** | `us.cohere.embed-v4:0` | Cohere | 1024-dimensional multilingual vector embeddings for MongoDB Atlas Vector Search. |
| **Fallback Vector Embedding** | `amazon.titan-embed-text-v2:0:8k` | Amazon | Native AWS text embedding fallback. |
| **Ultra-High Reasoning (Optional)**| `anthropic.claude-opus-4-7` / `deepseek.r1-v1:0` | Anthropic / DeepSeek | Advanced executive analytics and long-horizon business simulation. |
| **Lightweight Router (Alternative)**| `us.amazon.nova-2-lite-v1:0` | Amazon | Low-cost fallback for intent classification. |
| **Kitchen Voice Assistant** | `mistral.voxtral-small-24b-2507` / `amazon.nova-2-sonic-v1:0` | Mistral / Amazon | Real-time speech-to-text for kitchen staff hands-free queries. |

---

## ⚙️ 5. `.env` Configuration Blueprint

Add the exact model identifiers to your **`.env`** file at the root of `RestoMindAPI`:

```env
# ==========================================
# AWS BEDROCK CONFIGURATION (Region: us-east-1)
# ==========================================
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key

# Exact Approved Bedrock Model Identifiers
BEDROCK_PRIMARY_LLM=anthropic.claude-sonnet-4-6
BEDROCK_ROUTER_LLM=anthropic.claude-haiku-4-5-20251001-v1:0
BEDROCK_PRIMARY_EMBEDDING=us.cohere.embed-v4:0
BEDROCK_FALLBACK_EMBEDDING=amazon.titan-embed-text-v2:0:8k
BEDROCK_VOICE_MODEL=mistral.voxtral-small-24b-2507
```

---

## 🎯 6. Recommendation Engine Architecture

The **Recommendation Engine** converts aggregated data insights into structured, actionable business recommendations.

### Structured Recommendation Schema

```typescript
export interface StructuredRecommendation {
  recommendationId: string;
  title: string; // e.g. "Create 25% Discount on Expiring Butter Croissants"
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

---

## 🗄️ 8. Complete MongoDB Schemas Blueprint

### 1. `assistant_action_logs` Schema (`src/DB/Models/assistant-action-log.model.ts`)
```typescript
@Schema({ timestamps: true })
export class AssistantActionLog {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true, index: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  sessionId!: string;

  @Prop({ type: String, required: true })
  toolName!: string;

  @Prop({ type: Object, required: true })
  arguments!: Record<string, any>;

  @Prop({ type: String, enum: ['SUCCESS', 'FAILED', 'REJECTED_BY_USER', 'PENDING_APPROVAL'], required: true })
  executionStatus!: string;

  @Prop({ type: Number, default: 0 })
  durationMs!: number;

  @Prop({ type: String, required: true })
  modelUsed!: string; // e.g. "anthropic.claude-sonnet-4-6"

  @Prop({ type: Object, default: null })
  executionResult?: Record<string, any>;

  @Prop({ type: String, default: null })
  errorMessage?: string;
}
```

### 2. `recommendation_actions` Schema (`src/DB/Models/recommendation-action.model.ts`)
```typescript
@Schema({ timestamps: true })
export class RecommendationAction {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true, index: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Recommendation', required: true, index: true })
  recommendationId!: Types.ObjectId;

  @Prop({ type: String, enum: ['PENDING', 'SELECTED', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED'], required: true })
  status!: string;

  @Prop({ type: Boolean, default: false })
  selectedByUser!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  actedBy?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  executedAt?: Date;

  @Prop({ type: String, required: true })
  relatedTool!: string;

  @Prop({ type: Object, default: null })
  executionResult?: Record<string, any>;
}
```

### 3. `knowledge_vectors` Schema (`src/DB/Models/knowledge-vector.model.ts`)
```typescript
@Schema({ timestamps: true })
export class KnowledgeVector {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true, index: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ['product', 'recipe', 'offer', 'waste_report', 'recommendation', 'weekly_snapshot'] })
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

## 🏗️ 9. Target NestJS Folder Structure

```
src/
├── assistant/                               # Enterprise Agentic AI Module
│   ├── assistant.module.ts
│   ├── assistant.controller.ts
│   ├── services/
│   │   ├── assistant.service.ts             # Main Agent Orchestrator
│   │   ├── planner.service.ts               # Multi-Step Task Planner (Claude Haiku 4.5)
│   │   ├── tool-executor.service.ts         # Tool Registry & Execution Engine
│   │   ├── recommendation.service.ts       # Structured Recommendation Generator
│   │   ├── conversation-state.service.ts    # Multi-turn Workflow State Manager
│   │   ├── approval.service.ts              # Human-in-the-loop Guard & Audit Logger
│   │   └── arabic-normalizer.service.ts     # Egyptian Arabic Text Normalization
│   │
│   ├── tools/                               # Registered Agent Tools
│   │   ├── tool-registry.service.ts         # Central Tool Registry & Decorators
│   │   ├── query-tools/                     # Mongo Aggregation Read Tools
│   │   ├── rag-tools/                       # Atlas Vector Search RAG Tool
│   │   └── action-tools/                    # Business Mutation Tools (Approval Required)
│   │
│   ├── dto/
│   └── interfaces/
│
├── vector-store/                            # Vector Management Module
│   ├── vector-store.module.ts
│   ├── vector-store.service.ts              # MongoDB Atlas Vector Search API
│   ├── bedrock-embedding.service.ts         # AWS Bedrock Cohere Embed v4 Bridge
│   ├── listeners/
│   │   └── entity-change.listener.ts        # Auto-embeds products/offers on change
│   └── jobs/
│       └── weekly-snapshot.job.ts           # Sunday 01:00 AM Executive Snapshot Cron
```

---

## ⏱️ 10. Implementation Roadmap

* **Sprint 1**: AWS Bedrock SDK integration with `us.cohere.embed-v4:0`, Atlas vector index, `WeeklySnapshotSyncJob`.
* **Sprint 2**: Tool Registry, Mongo Query Tools, Action Tools, `PlannerService` with `anthropic.claude-haiku-4-5-20251001-v1:0`.
* **Sprint 3**: `AssistantService`, `RecommendationService`, `ApprovalService`, `ConversationStateService`, `assistant_action_logs` auditing.
* **Sprint 4**: Multi-tenant security audit, streaming SSE response integration, Egyptian Arabic dialect testing.
