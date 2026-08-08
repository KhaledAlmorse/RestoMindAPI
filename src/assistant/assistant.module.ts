import { Module } from '@nestjs/common';
import { VectorStoreModule } from 'src/vector-store/vector-store.module';
import { AIProviderModule } from 'src/ai-provider/ai-provider.module';
import {
  AssistantActionLogModel,
  RecommendationActionModel,
  AssistantChatHistoryModel,
  OfferModel,
  ProductModel,
  PurchaseOrderModel,
  SupplierModel,
  DailyProductionPlanModel,
  InventoryBatchModel,
  IngredientModel,
  WasteEventModel,
  SalesTransactionModel,
  PredictionModel,
  RecommendationModel,
  RecipeModel,
  WeeklyExecutiveSnapshotModel,
} from 'src/DB/Models';
import {
  AssistantActionLogRepository,
  RecommendationActionRepository,
  AssistantChatHistoryRepository,
  OfferRepository,
  ProductRepository,
  PurchaseOrderRepository,
  SupplierRepository,
  DailyProductionPlanRepository,
  InventoryBatchRepository,
  IngredientRepository,
  WasteEventRepository,
  SalesTransactionRepository,
  PredictionRepository,
  RecommendationRepository,
  WeeklyExecutiveSnapshotRepository,
} from 'src/DB/Repositories';

import { AssistantController } from './assistant.controller';
import { AssistantService } from './services/assistant.service';
import { ArabicNormalizerService } from './services/arabic-normalizer.service';
import { ConversationStateService } from './services/conversation-state.service';
import { PlannerService } from './services/planner.service';
import { ToolExecutorService } from './services/tool-executor.service';
import { RecommendationService } from './services/recommendation.service';
import { ApprovalService } from './services/approval.service';
import { ToolRegistryService } from './tools/tool-registry.service';

// Tools
import { InventoryQueryTool } from './tools/query-tools/inventory-query.tool';
import { RecipeQueryTool } from './tools/query-tools/recipe-query.tool';
import { WasteQueryTool } from './tools/query-tools/waste-query.tool';
import { SalesQueryTool } from './tools/query-tools/sales-query.tool';
import { PredictionQueryTool } from './tools/query-tools/prediction-query.tool';
import { KnowledgeSearchTool } from './tools/rag-tools/knowledge-search.tool';
import { OfferActionTool } from './tools/action-tools/offer-action.tool';
import { PurchaseOrderActionTool } from './tools/action-tools/po-action.tool';
import { ProductionActionTool } from './tools/action-tools/production-action.tool';

@Module({
  imports: [
    VectorStoreModule,
    AIProviderModule,
    AssistantActionLogModel,
    RecommendationActionModel,
    AssistantChatHistoryModel,
    OfferModel,
    ProductModel,
    PurchaseOrderModel,
    SupplierModel,
    DailyProductionPlanModel,
    InventoryBatchModel,
    IngredientModel,
    WasteEventModel,
    SalesTransactionModel,
    PredictionModel,
    RecommendationModel,
    RecipeModel,
    WeeklyExecutiveSnapshotModel,
  ],
  controllers: [AssistantController],
  providers: [
    // Repositories
    AssistantActionLogRepository,
    RecommendationActionRepository,
    AssistantChatHistoryRepository,
    OfferRepository,
    ProductRepository,
    PurchaseOrderRepository,
    SupplierRepository,
    DailyProductionPlanRepository,
    InventoryBatchRepository,
    IngredientRepository,
    WasteEventRepository,
    SalesTransactionRepository,
    PredictionRepository,
    RecommendationRepository,
    WeeklyExecutiveSnapshotRepository,

    // Services
    ArabicNormalizerService,
    ConversationStateService,
    ToolRegistryService,
    PlannerService,
    ToolExecutorService,
    RecommendationService,
    ApprovalService,
    AssistantService,

    // Tool Providers
    InventoryQueryTool,
    RecipeQueryTool,
    WasteQueryTool,
    SalesQueryTool,
    PredictionQueryTool,
    KnowledgeSearchTool,
    OfferActionTool,
    PurchaseOrderActionTool,
    ProductionActionTool,
  ],
  exports: [AssistantService, ApprovalService, ToolRegistryService],
})
export class AssistantModule {}
