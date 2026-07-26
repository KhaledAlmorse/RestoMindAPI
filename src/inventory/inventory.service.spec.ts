import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service';
import {
  IngredientRepository,
  InventoryBatchRepository,
  RestaurantRepository,
  StockTransactionRepository,
  UserRepository,
  WasteEventRepository,
} from 'src/DB/Repositories';

describe('InventoryService', () => {
  let service: InventoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: InventoryBatchRepository, useValue: {} },
        { provide: StockTransactionRepository, useValue: {} },
        { provide: WasteEventRepository, useValue: {} },
        { provide: IngredientRepository, useValue: {} },
        { provide: UserRepository, useValue: {} },
        { provide: RestaurantRepository, useValue: {} },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
