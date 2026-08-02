import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Auth } from 'src/Common/Decorators';

import { RolesEnum } from 'src/Common/Types';
import { PartnershipApplicationsService } from './partnership-applications.service';
import { CreatePartnershipApplicationDto } from './dto/create-partnership-application.dto';
import { QueryPartnershipApplicationDto } from './dto/query-partnership-application.dto';
import { RejectPartnershipApplicationDto } from './dto/reject-partnership-application.dto';
import { CheckApplicationStatusDto } from './dto/check-application-status.dto';
import { SetupAccountDto } from 'src/auth/dto/auth.dto';

@Controller()
export class PartnershipApplicationsController {
  constructor(
    private readonly partnershipApplicationsService: PartnershipApplicationsService,
  ) {}

  // ─── Public Routes ─────────────────────────────────────────────────────────

  @Post('partnership-applications')
  async submitApplication(@Body() dto: CreatePartnershipApplicationDto) {
    return this.partnershipApplicationsService.submitApplication(dto);
  }

  @Get('partnership-applications/status/:id')
  async checkStatus(
    @Param('id') id: string,
    @Query() query: CheckApplicationStatusDto,
  ) {
    return this.partnershipApplicationsService.checkStatus(id, query.email);
  }

  @Post('auth/setup-account')
  async setupAccount(@Body() dto: SetupAccountDto) {
    return this.partnershipApplicationsService.setupAccount(dto);
  }

  // ─── Admin Routes ──────────────────────────────────────────────────────────

  @Get('admin/partnership-applications')
  @Auth('admin')
  async findAllAdmin(@Query() query: QueryPartnershipApplicationDto) {
    return this.partnershipApplicationsService.findAllAdmin(query);
  }

  @Get('admin/partnership-applications/:id')
  @Auth('admin')
  async findOneAdmin(@Param('id') id: string) {
    return this.partnershipApplicationsService.findOneAdmin(id);
  }

  @Patch('admin/partnership-applications/:id/review')
  @Auth('admin')
  async markUnderReview(@Param('id') id: string, @Req() req: any) {
    const adminUserId = req.user.user._id.toString();
    return this.partnershipApplicationsService.markUnderReview(id, adminUserId);
  }

  @Post('admin/partnership-applications/:id/reject')
  @Auth('admin')
  async rejectApplication(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: RejectPartnershipApplicationDto,
  ) {
    const adminUserId = req.user.user._id.toString();
    return this.partnershipApplicationsService.rejectApplication(
      id,
      adminUserId,
      dto,
    );
  }

  @Post('admin/partnership-applications/:id/approve')
  @Auth('admin')
  async approveApplication(@Param('id') id: string, @Req() req: any) {
    const adminUserId = req.user.user._id.toString();
    return this.partnershipApplicationsService.approveApplication(
      id,
      adminUserId,
    );
  }

  @Post('admin/partnership-applications/:id/resend-approval-email')
  @Auth('admin')
  async resendApprovalEmail(@Param('id') id: string) {
    return this.partnershipApplicationsService.resendApprovalEmail(id);
  }
}
