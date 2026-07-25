import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrdersService } from './purchase-orders.service';
import {
  IngredientRepository,
  InventoryBatchRepository,
  PurchaseOrderRepository,
  RestaurantRepository,
  StockTransactionRepository,
  SupplierRepository,
  UserRepository,
} from 'src/DB/Repositories';

describe('PurchaseOrdersService', () => {
  let service: PurchaseOrdersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PurchaseOrderRepository, useValue: {} },
        { provide: SupplierRepository, useValue: {} },
        { provide: IngredientRepository, useValue: {} },
        { provide: InventoryBatchRepository, useValue: {} },
        { provide: StockTransactionRepository, useValue: {} },
        { provide: UserRepository, useValue: {} },
        { provide: RestaurantRepository, useValue: {} },
      ],
    }).compile();

    service = module.get<PurchaseOrdersService>(PurchaseOrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
