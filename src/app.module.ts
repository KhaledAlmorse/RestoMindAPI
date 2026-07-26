import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
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

@Module({
  imports: [
    MongooseModule.forRoot(process.env.DB_URL as string),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
