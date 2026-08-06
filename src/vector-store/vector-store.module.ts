import { Module } from '@nestjs/common';
import { AIProviderModule } from 'src/ai-provider/ai-provider.module';
import {
  KnowledgeVectorModel,
  WeeklyExecutiveSnapshotModel,
  SalesTransactionModel,
  WasteEventModel,
  PredictionModel,
  RestaurantModel,
  ProductModel,
  RecipeModel,
  OfferModel,
  WasteReportModel,
  RecommendationModel,
  IngredientModel,
} from 'src/DB/Models';
import {
  KnowledgeVectorRepository,
  WeeklyExecutiveSnapshotRepository,
  SalesTransactionRepository,
  WasteEventRepository,
  PredictionRepository,
  RestaurantRepository,
  ProductRepository,
  RecipeRepository,
  OfferRepository,
  WasteReportRepository,
  RecommendationRepository,
  IngredientRepository,
} from 'src/DB/Repositories';
import { BedrockEmbeddingService } from './bedrock-embedding.service';
import { VectorStoreService } from './vector-store.service';
import { EntityChangeListener } from './listeners/entity-change.listener';
import { WeeklySnapshotJob } from './jobs/weekly-snapshot.job';

@Module({
  imports: [
    AIProviderModule,
    KnowledgeVectorModel,
    WeeklyExecutiveSnapshotModel,
    SalesTransactionModel,
    WasteEventModel,
    PredictionModel,
    RestaurantModel,
    ProductModel,
    RecipeModel,
    OfferModel,
    WasteReportModel,
    RecommendationModel,
    IngredientModel,
  ],
  providers: [
    KnowledgeVectorRepository,
    WeeklyExecutiveSnapshotRepository,
    SalesTransactionRepository,
    WasteEventRepository,
    PredictionRepository,
    RestaurantRepository,
    ProductRepository,
    RecipeRepository,
    OfferRepository,
    WasteReportRepository,
    RecommendationRepository,
    IngredientRepository,
    BedrockEmbeddingService,
    VectorStoreService,
    EntityChangeListener,
    WeeklySnapshotJob,
  ],
  exports: [
    VectorStoreService,
    BedrockEmbeddingService,
    EntityChangeListener,
    WeeklySnapshotJob,
    KnowledgeVectorRepository,
    WeeklyExecutiveSnapshotRepository,
  ],
})
export class VectorStoreModule {}
