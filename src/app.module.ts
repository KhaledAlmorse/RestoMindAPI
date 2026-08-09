import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AiClientModule } from './Common/Services/ai-client.module';
import { ProductCostModule } from './Common/Services/product-cost.module';
import { AuthModule } from './auth/auth.module';
import { GlobalAuthModule } from './global.module';
import { UserModule } from './user/user.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { FavoritesModule } from './favorites/favorites.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { RestaurantModule } from './restaurant/restaurant.module';
import { OffersModule } from './offers/offers.module';
import { IngredientsModule } from './ingredients/ingredients.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SalesModule } from './sales/sales.module';
import { InventoryModule } from './inventory/inventory.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { ImportsModule } from './imports/imports.module';
import { ProductionPlanningModule } from './production-planning/production-planning.module';
import { WeeklyPredictionModule } from './weekly-prediction/weekly-prediction.module';
import { WasteReportsModule } from './waste-reports/waste-reports.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { PartnershipApplicationsModule } from './partnership-applications/partnership-applications.module';
import { VectorStoreModule } from './vector-store/vector-store.module';
import { AssistantModule } from './assistant/assistant.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { NotificationModule } from './notification/notification.module';
import { SanitizedLoggerInterceptor } from './Common/Interceptors/sanitized-logger.interceptor';
import { AllExceptionsFilter } from './Common/Filters/http-exception.filter';
import { PaymentsModule } from './payments/payments.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PayoutsModule } from './payouts/payouts.module';
import { SystemSettingsModule } from './system-settings/system-settings.module';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.DB_URL as string),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl:
          (process.env.RATE_LIMIT_TTL
            ? parseInt(process.env.RATE_LIMIT_TTL)
            : 60) * 1000,
        limit: process.env.RATE_LIMIT_LIMIT
          ? parseInt(process.env.RATE_LIMIT_LIMIT)
          : 100,
      },
    ]),
    AiClientModule,
    ProductCostModule,
    AuthModule,
    GlobalAuthModule,
    UserModule,
    CategoriesModule,
    ProductsModule,
    FavoritesModule,
    CartModule,
    OrdersModule,
    RestaurantModule,
    OffersModule,
    IngredientsModule,
    DashboardModule,
    SalesModule,
    InventoryModule,
    SuppliersModule,
    PurchaseOrdersModule,
    ImportsModule,
    ProductionPlanningModule,
    WeeklyPredictionModule,
    WasteReportsModule,
    RecommendationsModule,
    PartnershipApplicationsModule,
    VectorStoreModule,
    AssistantModule,
    NotificationModule,
    PaymentsModule.forRoot(),
    // Before SubscriptionsModule: its @Global service is read during
    // SubscriptionsService.onModuleInit, which gates the trial backfill.
    SystemSettingsModule,
    SubscriptionsModule,
    PayoutsModule,
  ],

  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: SanitizedLoggerInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
