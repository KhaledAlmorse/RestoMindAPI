import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import {
  UserRepository,
  RestaurantRepository,
  OfferRepository,
} from 'src/DB/Repositories';
import { TokenService } from 'src/Common/Services';
import { RolesEnum } from 'src/Common/Types';
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CreateUserDto } from './dto/create-user.dto';

describe('UserService - createUser authorization & role validation', () => {
  let service: UserService;
  let userRepository: any;
  let restaurantRepository: any;
  let tokenService: any;

  const mockManagerRestaurantId = new Types.ObjectId();
  const mockOtherRestaurantId = new Types.ObjectId();

  const mockManagerUser: any = {
    _id: new Types.ObjectId(),
    firstName: 'Manager',
    lastName: 'User',
    email: 'manager@restaurant.com',
    role: RolesEnum.MANAGER,
    restaurantId: mockManagerRestaurantId,
  };

  const mockAdminUser: any = {
    _id: new Types.ObjectId(),
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin@platform.com',
    role: RolesEnum.ADMIN,
  };

  beforeEach(async () => {
    userRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((data) =>
        Promise.resolve({
          _id: new Types.ObjectId(),
          ...data,
        }),
      ),
    };

    restaurantRepository = {
      findOne: jest.fn().mockImplementation(({ filters }) => {
        if (
          filters._id.toString() === mockManagerRestaurantId.toString() ||
          filters._id.toString() === mockOtherRestaurantId.toString()
        ) {
          return Promise.resolve({
            _id: filters._id,
            name: 'Test Restaurant',
          });
        }
        return Promise.resolve(null);
      }),
    };

    tokenService = {
      generate: jest.fn().mockReturnValue('mock-setup-token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: UserRepository, useValue: userRepository },
        { provide: RestaurantRepository, useValue: restaurantRepository },
        { provide: OfferRepository, useValue: {} },
        { provide: TokenService, useValue: tokenService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  describe('Manager role creation rules', () => {
    it('✅ Manager can create Staff', async () => {
      const dto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Staff',
        email: 'staff@restaurant.com',
        phone: '+12345678901',
        role: RolesEnum.STAFF,
      };

      const result = await service.createUser(dto, mockManagerUser);

      expect(result).toBeDefined();
      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'staff@restaurant.com',
          role: RolesEnum.STAFF,
          restaurantId: mockManagerRestaurantId,
          isActive: false,
        }),
      );
      expect(tokenService.generate).toHaveBeenCalled();
    });

    it('❌ Manager cannot create Customer', async () => {
      const dto: CreateUserDto = {
        firstName: 'Customer',
        lastName: 'User',
        email: 'customer@test.com',
        phone: '+12345678902',
        password: 'Password123!',
        role: RolesEnum.CUSTOMER,
      };

      await expect(service.createUser(dto, mockManagerUser)).rejects.toThrow(
        new ForbiddenException('Managers can only create Staff accounts.'),
      );
      expect(userRepository.create).not.toHaveBeenCalled();
    });

    it('❌ Manager cannot create Manager', async () => {
      const dto: CreateUserDto = {
        firstName: 'New',
        lastName: 'Manager',
        email: 'newmanager@test.com',
        phone: '+12345678903',
        password: 'Password123!',
        role: RolesEnum.MANAGER,
      };

      await expect(service.createUser(dto, mockManagerUser)).rejects.toThrow(
        new ForbiddenException('Managers can only create Staff accounts.'),
      );
      expect(userRepository.create).not.toHaveBeenCalled();
    });

    it('❌ Manager cannot create Admin', async () => {
      const dto: CreateUserDto = {
        firstName: 'New',
        lastName: 'Admin',
        email: 'newadmin@test.com',
        phone: '+12345678904',
        password: 'Password123!',
        role: RolesEnum.ADMIN,
      };

      await expect(service.createUser(dto, mockManagerUser)).rejects.toThrow(
        new ForbiddenException('Managers can only create Staff accounts.'),
      );
      expect(userRepository.create).not.toHaveBeenCalled();
    });

    it('❌ Manager cannot assign another restaurant', async () => {
      const dto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Staff',
        email: 'staff2@restaurant.com',
        phone: '+12345678905',
        role: RolesEnum.STAFF,
        restaurantId: mockOtherRestaurantId.toString(), // Attemping to pass another restaurantId
      };

      await service.createUser(dto, mockManagerUser);

      // Verify that restaurantId was forced to mockManagerRestaurantId and NOT mockOtherRestaurantId
      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: RolesEnum.STAFF,
          restaurantId: mockManagerRestaurantId,
        }),
      );
    });
  });

  describe('Admin role creation rules', () => {
    it('✅ Admin can create all supported roles (Admin, Manager, Customer, Staff)', async () => {
      const roles = [
        RolesEnum.ADMIN,
        RolesEnum.MANAGER,
        RolesEnum.CUSTOMER,
        RolesEnum.STAFF,
      ];

      for (const role of roles) {
        const dto: CreateUserDto = {
          firstName: 'User',
          lastName: role,
          email: `${role.toLowerCase()}@test.com`,
          phone: `+1000000000${roles.indexOf(role)}`,
          password: 'Password123!',
          role,
          ...(role === RolesEnum.STAFF || role === RolesEnum.MANAGER
            ? { restaurantId: mockManagerRestaurantId.toString() }
            : {}),
        };

        const result = await service.createUser(dto, mockAdminUser);
        expect(result).toBeDefined();
      }

      expect(userRepository.create).toHaveBeenCalledTimes(4);
    });
  });
});
