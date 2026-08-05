import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AiClientModule } from './Common/Services/ai-client.module';
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
import { PaymentsModule } from './payments/payments.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.DB_URL as string),
    ScheduleModule.forRoot(),
    AiClientModule,
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
    PaymentsModule.forRoot(),
    SubscriptionsModule,
  ],

  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
