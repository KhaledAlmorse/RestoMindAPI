import { Test, TestingModule } from '@nestjs/testing';
import { SuppliersService } from './suppliers.service';
import {
  RestaurantRepository,
  SupplierRepository,
  UserRepository,
} from 'src/DB/Repositories';

describe('SuppliersService', () => {
  let service: SuppliersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: SupplierRepository, useValue: {} },
        { provide: UserRepository, useValue: {} },
        { provide: RestaurantRepository, useValue: {} },
      ],
    }).compile();

    service = module.get<SuppliersService>(SuppliersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
