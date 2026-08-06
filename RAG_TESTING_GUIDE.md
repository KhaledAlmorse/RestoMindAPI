# RestoMind RAG & Agentic AI System — Testing Guide

This guide provides **10 comprehensive testing scenarios** with ready-to-run cURL commands and JSON payloads to test the RAG search, inventory analytics, waste reduction recommendations, action tools, and session management endpoints in **RestoMind**.

---

## 🔑 Authentication Setup

Before running the test commands, authenticate via `POST /auth/login` to obtain your Bearer access token:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "manager@bakery.com",
    "password": "Password123!"
  }'
```

Save the returned `accessToken` and use it in the `Authorization: Bearer <TOKEN>` header.

---

## 🧪 10 RAG & Agentic AI Test Scenarios

### 1️⃣ Recipe & Product Knowledge Search (Arabic Vector RAG)
* **Prompt**: `"ايه الأطباق اللي فيها زبدة؟"`
* **Intent Category**: `Information`
* **Executed Tool**: `searchKnowledge`
* **Description**: Tests MongoDB Atlas Vector & Hybrid Search over embedded products and recipes containing butter.

```bash
curl -X POST http://localhost:3000/assistant/chat \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "ايه الأطباق اللي فيها زبدة؟",
    "sessionId": "test_session_01"
  }'
```

---

### 2️⃣ Category & Menu Knowledge Search (English RAG)
* **Prompt**: `"What products do I have in the Bakery category?"`
* **Intent Category**: `Information`
* **Executed Tool**: `searchKnowledge`
* **Description**: Tests cross-lingual search across menu items and product titles.

```bash
curl -X POST http://localhost:3000/assistant/chat \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What products do I have in the Bakery category?",
    "sessionId": "test_session_01"
  }'
```

---

### 3️⃣ Expiring Stock & Inventory Deficits
* **Prompt**: `"كام منتج مخزون قرب ينتهي خلال الأسبوع ده؟"`
* **Intent Category**: `Analytics`
* **Executed Tool**: `getInventoryStatus({ filter: "expiring" })`
* **Description**: Queries live `inventory_batches` for items expiring within 7 days.

```bash
curl -X POST http://localhost:3000/assistant/chat \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "كام منتج مخزون قرب ينتهي خلال الأسبوع ده؟",
    "sessionId": "test_session_01"
  }'
```

---

### 4️⃣ Waste Cost Analysis & Primary Drivers
* **Prompt**: `"تكلفة الهدر كام الأسبوع ده وايه اكتر مكون بيتهدر؟"`
* **Intent Category**: `Analytics` / `Recommendation`
* **Executed Tool**: `getWasteSummary({ period: "7_days" })`
* **Description**: Aggregates `waste_events` cost totals, primary waste reasons, and top wasted ingredients.

```bash
curl -X POST http://localhost:3000/assistant/chat \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "تكلفة الهدر كام الأسبوع ده وايه اكتر مكون بيتهدر؟",
    "sessionId": "test_session_01"
  }'
```

---

### 5️⃣ Period-over-Period Sales Comparison
* **Prompt**: `"قارن مبيعات الأسبوع ده مع الأسبوع اللي فات"`
* **Intent Category**: `Analytics`
* **Executed Tool**: `getSalesComparison({ windowDays: 7 })`
* **Description**: Aggregates `sales_transactions` and calculates revenue growth percentage.

```bash
curl -X POST http://localhost:3000/assistant/chat \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "قارن مبيعات الأسبوع ده مع الأسبوع اللي فات",
    "sessionId": "test_session_01"
  }'
```

---

### 6️⃣ AI Demand Predictions & Order Forecasting
* **Prompt**: `"ايه التوقعات للطلبات الأسبوع الجاي؟"`
* **Intent Category**: `Analytics`
* **Executed Tool**: `getPredictions({ horizon: "7_days" })`
* **Description**: Fetches AI order demand forecasts and confidence levels.

```bash
curl -X POST http://localhost:3000/assistant/chat \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "ايه التوقعات للطلبات الأسبوع الجاي؟",
    "sessionId": "test_session_01"
  }'
```

---

### 7️⃣ Executive Summary & Performance Report
* **Prompt**: `"اعملي تقرير تنفيذي عن أداء المطعم للأسبوع الماضي"`
* **Intent Category**: `Analytics` / `Information`
* **Executed Tool**: `generateExecutiveReport({ period: "last_week" })`
* **Description**: Fetches executive performance snapshot records.

```bash
curl -X POST http://localhost:3000/assistant/chat \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "اعملي تقرير تنفيذي عن أداء المطعم للأسبوع الماضي",
    "sessionId": "test_session_01"
  }'
```

---

### 8️⃣ Multi-Tool Recommendation Query
* **Prompt**: `"كام منتج قرب ينتهي وايه التوصيات لتقليل الهدر؟"`
* **Intent Category**: `Recommendation`
* **Executed Tools**: `getInventoryStatus`, `getWasteSummary`, `generateStructuredRecommendations`
* **Description**: Multi-tool execution generating structured JSON recommendation cards with `actionPayload`.

```bash
curl -X POST http://localhost:3000/assistant/chat \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "كام منتج قرب ينتهي وايه التوصيات لتقليل الهدر؟",
    "sessionId": "test_session_01"
  }'
```

---

### 9️⃣ Human-in-the-Loop Action Approval
* **Prompt**: `"اعمل عرض خصم 20% على الكرواسون"`
* **Intent Category**: `Action`
* **Executed Tool**: `createOffer` (Requires Approval: `true`)
* **Description**: Generates a pending action that must be confirmed via `POST /assistant/approve-action`.

```bash
# Step A: Send Action Intent Chat Request
curl -X POST http://localhost:3000/assistant/chat \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "اعمل عرض خصم 20% على الكرواسون",
    "sessionId": "test_session_01"
  }'

# Step B: Approve the Action Tool Execution
curl -X POST http://localhost:3000/assistant/approve-action \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "recommendationActionId": "RECOMMENDATION_ID_FROM_STEP_A",
    "toolName": "createOffer",
    "arguments": {
      "productId": "PRODUCT_ID_FROM_STEP_A",
      "discountPercentage": 20,
      "availableQuantity": 25,
      "daysDuration": 3
    },
    "approved": true,
    "sessionId": "test_session_01"
  }'
```

---

### 🔟 Conversation & Greeting
* **Prompt**: `"hello"`
* **Intent Category**: `Conversation`
* **Executed Tools**: None (`steps: []`)
* **Description**: Returns a warm, executive Egyptian Arabic greeting outlining RestoMind Assistant's capabilities.

```bash
curl -X POST http://localhost:3000/assistant/chat \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "hello",
    "sessionId": "test_session_01"
  }'
```

---

## 📡 Assistant Endpoints Quick Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/assistant/chat` | Main Agent Orchestrator Endpoint |
| `POST` | `/assistant/approve-action` | Human-in-the-Loop Approval Confirmation |
| `POST` | `/assistant/sync-vectors` | Manual Vector Sync / Re-indexing Endpoint |
| `GET` | `/assistant/sessions` | List user chat sessions |
| `GET` | `/assistant/sessions/:sessionId` | Get full chat history for a session |
| `DELETE` | `/assistant/sessions/:sessionId` | Delete a chat thread |
