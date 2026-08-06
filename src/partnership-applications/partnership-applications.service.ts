import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  PartnershipApplicationRepository,
  RestaurantRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { PartnershipApplicationStatusEnum, RolesEnum } from 'src/Common/Types';
import { TokenService } from 'src/Common/Services';
import { sendEmail } from 'src/Common/Utils/send-email.utils';
import { addDays } from 'src/Common/Utils';
import { SystemSettingsService } from 'src/system-settings/system-settings.service';
import { CreatePartnershipApplicationDto } from './dto/create-partnership-application.dto';
import { QueryPartnershipApplicationDto } from './dto/query-partnership-application.dto';
import { RejectPartnershipApplicationDto } from './dto/reject-partnership-application.dto';
import { SetupAccountDto } from 'src/auth/dto/auth.dto';

@Injectable()
export class PartnershipApplicationsService {
  private readonly logger = new Logger(PartnershipApplicationsService.name);

  constructor(
    private readonly partnershipApplicationRepository: PartnershipApplicationRepository,
    private readonly userRepository: UserRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly tokenService: TokenService,
    private readonly systemSettingsService: SystemSettingsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private validateObjectId(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  /**
   * Public partnership application submission.
   */
  async submitApplication(dto: CreatePartnershipApplicationDto) {
    // Duplicate-pending check
    const existingPending = await this.partnershipApplicationRepository.findOne(
      {
        filters: {
          email: dto.email.toLowerCase(),
          status: {
            $in: [
              PartnershipApplicationStatusEnum.PENDING,
              PartnershipApplicationStatusEnum.UNDER_REVIEW,
            ],
          },
          isDeleted: false,
        },
      },
    );

    if (existingPending) {
      throw new ConflictException(
        'You already have a pending or under-review partnership application.',
      );
    }

    const application = await this.partnershipApplicationRepository.create({
      ...dto,
      email: dto.email.toLowerCase(),
      status: PartnershipApplicationStatusEnum.PENDING,
    } as any);

    return {
      message: 'Partnership application submitted successfully.',
      application,
    };
  }

  /**
   * Public status check. Requires matching email to prevent ID enumeration.
   */
  async checkStatus(id: string, email: string) {
    this.validateObjectId(id);

    const application = await this.partnershipApplicationRepository.findOne({
      filters: { _id: new Types.ObjectId(id), isDeleted: false },
    });

    if (
      !application ||
      application.email.toLowerCase() !== email.trim().toLowerCase()
    ) {
      throw new NotFoundException('Application not found');
    }

    return {
      id: application._id,
      businessName: application.businessName,
      status: application.status,
      createdAt: (application as any).createdAt,
    };
  }

  /**
   * Admin list view, paginated and filterable by status.
   */
  async findAllAdmin(query: QueryPartnershipApplicationDto) {
    const { page = 1, limit = 10, status } = query;
    const skip = (page - 1) * limit;

    const filters: Record<string, any> = { isDeleted: false };
    if (status) {
      filters.status = status;
    }

    return this.partnershipApplicationRepository.findManyPaginated({
      filters,
      skip,
      limit,
      sort: 'createdAt',
      order: 'desc',
      populationArray: [
        { path: 'reviewedBy', select: 'firstName lastName email' },
        { path: 'approvedBy', select: 'firstName lastName email' },
        { path: 'userId', select: 'firstName lastName email role' },
        { path: 'restaurantId', select: 'name phone' },
      ],
    });
  }

  /**
   * Admin single application detail view.
   */
  async findOneAdmin(id: string) {
    this.validateObjectId(id);

    const application = await this.partnershipApplicationRepository.findOne({
      filters: { _id: new Types.ObjectId(id), isDeleted: false },
      populationArray: [
        { path: 'reviewedBy', select: 'firstName lastName email' },
        { path: 'approvedBy', select: 'firstName lastName email' },
        { path: 'userId', select: 'firstName lastName email role' },
        { path: 'restaurantId', select: 'name phone address' },
      ],
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    return application;
  }

  /**
   * Admin mark as UNDER_REVIEW (PENDING -> UNDER_REVIEW).
   */
  async markUnderReview(id: string, adminUserId: string) {
    this.validateObjectId(id);

    const application = await this.partnershipApplicationRepository.findOne({
      filters: { _id: new Types.ObjectId(id), isDeleted: false },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    // Terminal state or non-reviewable checks
    if (
      application.status === PartnershipApplicationStatusEnum.REJECTED ||
      application.status === PartnershipApplicationStatusEnum.ONBOARDED ||
      application.status === PartnershipApplicationStatusEnum.APPROVED
    ) {
      throw new ConflictException(
        `Cannot transition application from current status "${application.status}" to UNDER_REVIEW.`,
      );
    }

    if (application.status === PartnershipApplicationStatusEnum.UNDER_REVIEW) {
      return application;
    }

    const updated = await this.partnershipApplicationRepository.update({
      filters: { _id: application._id },
      body: {
        status: PartnershipApplicationStatusEnum.UNDER_REVIEW,
        reviewedBy: new Types.ObjectId(adminUserId),
      } as any,
    });

    return updated ?? application;
  }

  /**
   * Admin reject application (PENDING/UNDER_REVIEW -> REJECTED).
   */
  async rejectApplication(
    id: string,
    adminUserId: string,
    dto: RejectPartnershipApplicationDto,
  ) {
    this.validateObjectId(id);

    const application = await this.partnershipApplicationRepository.findOne({
      filters: { _id: new Types.ObjectId(id), isDeleted: false },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    if (
      application.status === PartnershipApplicationStatusEnum.REJECTED ||
      application.status === PartnershipApplicationStatusEnum.ONBOARDED ||
      application.status === PartnershipApplicationStatusEnum.APPROVED
    ) {
      throw new ConflictException(
        `Application is in status "${application.status}" and cannot be rejected.`,
      );
    }

    const updated = await this.partnershipApplicationRepository.update({
      filters: { _id: application._id },
      body: {
        status: PartnershipApplicationStatusEnum.REJECTED,
        rejectionReason: dto.reason,
        reviewedBy: new Types.ObjectId(adminUserId),
      } as any,
    });

    // Send rejection email (non-blocking)
    sendEmail({
      to: application.email,
      subject: 'RestoMind Partnership Application Update',
      html: `
        <h3>Application Update</h3>
        <p>Dear ${application.ownerFirstName},</p>
        <p>Thank you for submitting a partnership application for <strong>${application.businessName}</strong>.</p>
        <p>After review, we regret to inform you that we cannot approve your application at this time.</p>
        <p><strong>Reason:</strong> ${dto.reason}</p>
        <p>Best regards,<br/>RestoMind Team</p>
      `,
    }).catch((err) => {
      this.logger.error(
        `Failed to send rejection email to ${application.email}: ${err?.message}`,
      );
    });

    return updated ?? application;
  }

  /**
   * Admin approve application (atomic User + Restaurant creation).
   */
  async approveApplication(id: string, adminUserId: string) {
    this.validateObjectId(id);

    const application = await this.partnershipApplicationRepository.findOne({
      filters: { _id: new Types.ObjectId(id), isDeleted: false },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    if (
      application.status !== PartnershipApplicationStatusEnum.PENDING &&
      application.status !== PartnershipApplicationStatusEnum.UNDER_REVIEW
    ) {
      throw new ConflictException(
        `Application in status "${application.status}" cannot be approved.`,
      );
    }

    // Duplicate user email check before transaction
    const existingUser = await this.userRepository.findOne({
      filters: { email: application.email.toLowerCase(), isDeleted: false },
    });

    if (existingUser) {
      throw new ConflictException(
        `A user account with email "${application.email}" already exists. Manual resolution required.`,
      );
    }

    const userId = new Types.ObjectId();
    const restaurantId = new Types.ObjectId();
    const randomPassword = bcrypt.hashSync(
      crypto.randomBytes(16).toString('hex'),
      10,
    );

    let session: any = null;
    try {
      session = await this.connection.startSession();
      session.startTransaction();

      // 1. Create User as Manager
      const createdUser = await this.userRepository.create({
        _id: userId,
        firstName: application.ownerFirstName,
        lastName: application.ownerLastName,
        email: application.email.toLowerCase(),
        phone: application.phone,
        role: RolesEnum.MANAGER,
        isEmailVerified: true,
        password: randomPassword,
        restaurantId,
      } as any);

      // 2. Create Restaurant
      const createdRestaurant = await this.restaurantRepository.create({
        _id: restaurantId,
        name: application.businessName,
        ownerUserId: userId,
        phone: application.phone,
        description: application.description,
        address: {
          city: application.city,
          district: application.district,
          street: application.street,
        },
        isActive: true,
      } as any);

      // 3. Update Partnership Application
      await this.partnershipApplicationRepository.update({
        filters: { _id: application._id },
        body: {
          status: PartnershipApplicationStatusEnum.APPROVED,
          userId,
          restaurantId,
          approvedBy: new Types.ObjectId(adminUserId),
          approvedAt: new Date(),
        } as any,
      });

      await session.commitTransaction();
      session.endSession();
    } catch (error: any) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      this.logger.error(`Approval transaction failed: ${error?.message}`);
      throw error;
    }

    // Generate non-blocking Setup Token (72 hours expiry)
    const setupToken = this.tokenService.generate(
      {
        id: userId.toString(),
        email: application.email.toLowerCase(),
        tokenType: 'setup',
      },
      {
        secret: process.env.ACCESS_TOKEN_SECRET,
        expiresIn: '72h',
      },
    );

    const setupUrl = `${
      process.env.FRONTEND_URL || 'https://restomind.com'
    }/setup-account?token=${setupToken}`;

    sendEmail({
      to: application.email,
      subject: 'RestoMind Partnership Approved — Complete Your Account Setup',
      html: `
        <h3>Welcome to RestoMind!</h3>
        <p>Dear ${application.ownerFirstName},</p>
        <p>Your partnership application for <strong>${application.businessName}</strong> has been approved!</p>
        <p>Please click the link below to set your account password and activate your restaurant manager portal:</p>
        <p><a href="${setupUrl}">${setupUrl}</a></p>
        <p>This setup link is valid for 72 hours.</p>
        <p>Best regards,<br/>RestoMind Team</p>
      `,
    }).catch((err) => {
      this.logger.error(
        `Failed to send approval email to ${application.email}: ${err?.message}`,
      );
    });

    return {
      message: 'Application approved successfully.',
      userId,
      restaurantId,
      status: PartnershipApplicationStatusEnum.APPROVED,
    };
  }

  /**
   * Resend approval setup email with a fresh token for APPROVED applications.
   */
  async resendApprovalEmail(id: string) {
    this.validateObjectId(id);

    const application = await this.partnershipApplicationRepository.findOne({
      filters: { _id: new Types.ObjectId(id), isDeleted: false },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    if (
      application.status !== PartnershipApplicationStatusEnum.APPROVED ||
      !application.userId
    ) {
      throw new BadRequestException(
        'Can only resend setup email for approved applications awaiting setup completion.',
      );
    }

    const setupToken = this.tokenService.generate(
      {
        id: application.userId.toString(),
        email: application.email.toLowerCase(),
        tokenType: 'setup',
      },
      {
        secret: process.env.ACCESS_TOKEN_SECRET,
        expiresIn: '72h',
      },
    );

    const setupUrl = `${
      process.env.FRONTEND_URL || 'https://restomind.com'
    }/setup-account?token=${setupToken}`;

    await sendEmail({
      to: application.email,
      subject: 'RestoMind Account Setup — Link Resent',
      html: `
        <h3>RestoMind Account Setup</h3>
        <p>Dear ${application.ownerFirstName},</p>
        <p>Here is your new setup link to activate your restaurant manager portal for <strong>${application.businessName}</strong>:</p>
        <p><a href="${setupUrl}">${setupUrl}</a></p>
        <p>This link is valid for 72 hours.</p>
        <p>Best regards,<br/>RestoMind Team</p>
      `,
    });

    return { message: 'Approval setup email resent successfully.' };
  }

  /**
   * Owner setup account (verify setup token, set password, mark application ONBOARDED).
   */
  async setupAccount(dto: SetupAccountDto) {
    let decoded: any;
    try {
      decoded = this.tokenService.verify(dto.token, {
        secret: process.env.ACCESS_TOKEN_SECRET,
      });
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired setup token.');
    }

    if (!decoded || decoded.tokenType !== 'setup') {
      throw new UnauthorizedException('Invalid token type for account setup.');
    }

    const userId = decoded.id;
    this.validateObjectId(userId);

    const user = await this.userRepository.findOne({
      filters: { _id: new Types.ObjectId(userId), isDeleted: false },
    });

    if (!user) {
      throw new NotFoundException('User account not found.');
    }

    const hashedPassword = bcrypt.hashSync(dto.password, 10);
    const now = new Date();

    await this.userRepository.update({
      filters: { _id: user._id },
      body: {
        password: hashedPassword,
        passwordChangedAt: now,
        isEmailVerified: true,
        isActive: true,
        employmentStatus: 'active',
      } as any,
    });

    // Mark PartnershipApplication as ONBOARDED
    const application = await this.partnershipApplicationRepository.findOne({
      filters: { userId: user._id, isDeleted: false },
    });

    if (application) {
      await this.partnershipApplicationRepository.update({
        filters: { _id: application._id },
        body: {
          status: PartnershipApplicationStatusEnum.ONBOARDED,
        } as any,
      });

      // The trial clock starts when the owner actually reaches the product,
      // not when the admin approved it — an approval email left unread for a
      // week should cost the merchant nothing.
      if (application.restaurantId) {
        const settings = await this.systemSettingsService.get();
        const update: Record<string, any> = {};

        if (settings.freeTrialEnabled) {
          update['subscription.trialEndsAt'] = addDays(
            new Date(),
            settings.trialDurationDays,
          );
        }

        // The seat is claimed once, here, and never recomputed. Counting at
        // checkout instead would let renewals eat the seats, would reprice a
        // merchant who was promised the early-bird rate, and would let two
        // merchants claim the last seat at the same time.
        if (settings.earlyBirdEnabled) {
          const claimed = await this.systemSettingsService.countEarlyBirds();
          if (claimed < settings.earlyBirdCap) {
            update['subscription.earlyBird'] = true;
          }
        }

        if (Object.keys(update).length) {
          await this.restaurantRepository.update({
            filters: { _id: application.restaurantId },
            body: update as any,
          });
        }
      }
    }

    return {
      message:
        'Account password setup completed successfully. You can now log in.',
    };
  }
}
