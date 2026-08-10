import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PartnershipApplicationsService } from './partnership-applications.service';
import {
  PartnershipApplicationRepository,
  RestaurantRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { TokenService } from 'src/Common/Services';
import { SystemSettingsService } from 'src/system-settings/system-settings.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BusinessTypeEnum,
  PartnershipApplicationStatusEnum,
  RolesEnum,
} from 'src/Common/Types';
import { Types } from 'mongoose';

describe('PartnershipApplicationsService', () => {
  let service: PartnershipApplicationsService;
  let applicationRepo: jest.Mocked<PartnershipApplicationRepository>;
  let userRepo: jest.Mocked<UserRepository>;
  let restaurantRepo: jest.Mocked<RestaurantRepository>;
  let tokenService: jest.Mocked<TokenService>;
  let connection: any;

  const mockAdminId = new Types.ObjectId().toString();

  const mockApplication = {
    _id: new Types.ObjectId(),
    applicationId: 'RESTO-000001',
    businessName: 'Test Bistro',
    businessType: BusinessTypeEnum.RESTAURANT,
    ownerFirstName: 'John',
    ownerLastName: 'Doe',
    email: 'john.doe@example.com',
    phone: '+201234567890',
    city: 'Cairo',
    district: 'Maadi',
    street: 'Street 9',
    status: PartnershipApplicationStatusEnum.PENDING,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const mockAppRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findManyPaginated: jest.fn(),
    };

    const mockUserRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    const mockRestaurantRepo = {
      create: jest.fn(),
    };

    const mockTokenSvc = {
      generate: jest.fn().mockReturnValue('mock-setup-token'),
      verify: jest.fn(),
    };

    const mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
    };

    connection = {
      startSession: jest.fn().mockResolvedValue(mockSession),
      collection: jest.fn().mockReturnValue({
        findOneAndUpdate: jest.fn().mockResolvedValue({ seq: 1 }),
      }),
    };

    // Platform defaults: trials on, early-bird seats available.
    const mockSystemSettings = {
      get: jest.fn().mockResolvedValue({
        freeTrialEnabled: true,
        trialDurationDays: 14,
        earlyBirdEnabled: true,
        earlyBirdCap: 30,
      }),
      countEarlyBirds: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartnershipApplicationsService,
        { provide: PartnershipApplicationRepository, useValue: mockAppRepo },
        { provide: UserRepository, useValue: mockUserRepo },
        { provide: RestaurantRepository, useValue: mockRestaurantRepo },
        { provide: TokenService, useValue: mockTokenSvc },
        { provide: SystemSettingsService, useValue: mockSystemSettings },
        // Emits an application-created event; the listener is not under test.
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: 'DatabaseConnection', useValue: connection },
      ],
    }).compile();

    service = module.get<PartnershipApplicationsService>(
      PartnershipApplicationsService,
    );
    applicationRepo = module.get(PartnershipApplicationRepository);
    userRepo = module.get(UserRepository);
    restaurantRepo = module.get(RestaurantRepository);
    tokenService = module.get(TokenService);
  });

  describe('submitApplication', () => {
    it('creates a new partnership application if no pending application exists', async () => {
      applicationRepo.findOne.mockResolvedValue(null as any);
      applicationRepo.create.mockResolvedValue(mockApplication as any);

      const dto = {
        businessName: 'Test Bistro',
        businessType: BusinessTypeEnum.RESTAURANT,
        ownerFirstName: 'John',
        ownerLastName: 'Doe',
        email: 'john.doe@example.com',
        phone: '+201234567890',
        city: 'Cairo',
      };

      const result = await service.submitApplication(dto);

      expect(applicationRepo.findOne).toHaveBeenCalled();
      expect(applicationRepo.create).toHaveBeenCalled();
      expect(result.application).toBeDefined();
    });

    it('rejects submission if a pending application already exists for email', async () => {
      applicationRepo.findOne.mockResolvedValue(mockApplication as any);

      const dto = {
        businessName: 'Test Bistro',
        businessType: BusinessTypeEnum.RESTAURANT,
        ownerFirstName: 'John',
        ownerLastName: 'Doe',
        email: 'john.doe@example.com',
        phone: '+201234567890',
        city: 'Cairo',
      };

      await expect(service.submitApplication(dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('checkStatus', () => {
    it('returns application status if email matches stored application', async () => {
      applicationRepo.findOne.mockResolvedValue(mockApplication as any);

      const result = await service.checkStatus(
        mockApplication.applicationId,
        'john.doe@example.com',
      );

      expect(result.status).toBe(PartnershipApplicationStatusEnum.PENDING);
      expect(result.businessName).toBe('Test Bistro');
    });

    it('throws NotFoundException if email does not match stored application', async () => {
      applicationRepo.findOne.mockResolvedValue(mockApplication as any);

      await expect(
        service.checkStatus(
          mockApplication.applicationId,
          'wrong.email@example.com',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('markUnderReview', () => {
    it('transitions PENDING application to UNDER_REVIEW', async () => {
      applicationRepo.findOne.mockResolvedValue(mockApplication as any);
      applicationRepo.update.mockResolvedValue({
        ...mockApplication,
        status: PartnershipApplicationStatusEnum.UNDER_REVIEW,
      } as any);

      const result = await service.markUnderReview(
        mockApplication._id.toString(),
        mockAdminId,
      );

      expect(applicationRepo.update).toHaveBeenCalled();
      expect(result.status).toBe(PartnershipApplicationStatusEnum.UNDER_REVIEW);
    });

    it('prevents state transition if application is already in terminal REJECTED status', async () => {
      applicationRepo.findOne.mockResolvedValue({
        ...mockApplication,
        status: PartnershipApplicationStatusEnum.REJECTED,
      } as any);

      await expect(
        service.markUnderReview(mockApplication._id.toString(), mockAdminId),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('rejectApplication', () => {
    it('transitions application to REJECTED with reason', async () => {
      applicationRepo.findOne.mockResolvedValue(mockApplication as any);
      applicationRepo.update.mockResolvedValue({
        ...mockApplication,
        status: PartnershipApplicationStatusEnum.REJECTED,
        rejectionReason: 'Invalid documentation',
      } as any);

      const result = await service.rejectApplication(
        mockApplication._id.toString(),
        mockAdminId,
        { reason: 'Invalid documentation' },
      );

      expect(result.status).toBe(PartnershipApplicationStatusEnum.REJECTED);
    });

    it('blocks rejection if application is already APPROVED', async () => {
      applicationRepo.findOne.mockResolvedValue({
        ...mockApplication,
        status: PartnershipApplicationStatusEnum.APPROVED,
      } as any);

      await expect(
        service.rejectApplication(mockApplication._id.toString(), mockAdminId, {
          reason: 'Invalid',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
