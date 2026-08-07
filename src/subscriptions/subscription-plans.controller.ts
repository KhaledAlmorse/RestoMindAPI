import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { type IAuthUser } from 'src/Common/Types';
import { RestaurantRepository } from 'src/DB/Repositories';
import {
  CreatePlanDto,
  SetPlanArchivedDto,
  UpdatePlanDto,
} from './dto/subscription-plan.dto';
import { SubscriptionPlansService } from './subscription-plans.service';

/**
 * Admin plan management. Mirrors SystemSettingsController: admin-only
 * throughout, and every mutation is logged with the admin's id, because
 * "who changed the price" is a question someone will eventually ask.
 */
@Controller('admin/plans')
export class SubscriptionPlansController {
  constructor(
    private readonly plansService: SubscriptionPlansService,
    private readonly restaurantRepository: RestaurantRepository,
  ) {}

  /**
   * Every plan, archived included, each with the number of restaurants on it
   * so the admin screen can warn before archiving or deleting.
   */
  @Get()
  @Auth('admin')
  async list() {
    const plans = await this.plansService.list(true);

    const data = await Promise.all(
      plans.map(async (plan) => ({
        slug: plan.slug,
        label: plan.label,
        productCap: plan.productCap ?? null,
        prices: {
          monthly: plan.prices?.monthly ?? null,
          halfYearly: plan.prices?.halfYearly ?? null,
          yearly: plan.prices?.yearly ?? null,
        },
        sortOrder: plan.sortOrder,
        archived: plan.archived,
        isTrialPlan: plan.isTrialPlan,
        holderCount: await this.restaurantRepository.countDocuments({
          'subscription.tier': plan.slug,
        }),
      })),
    );

    return { data };
  }

  @Post()
  @Auth('admin')
  create(@Body() body: CreatePlanDto, @AuthUser() user: IAuthUser) {
    return this.plansService.create(body, user.user._id.toString());
  }

  @Patch(':slug')
  @Auth('admin')
  update(
    @Param('slug') slug: string,
    @Body() body: UpdatePlanDto,
    @AuthUser() user: IAuthUser,
  ) {
    return this.plansService.update(slug, body, user.user._id.toString());
  }

  @Patch(':slug/archive')
  @Auth('admin')
  archive(
    @Param('slug') slug: string,
    @Body() body: SetPlanArchivedDto,
    @AuthUser() user: IAuthUser,
  ) {
    return this.plansService.setArchived(
      slug,
      body.archived,
      user.user._id.toString(),
    );
  }

  @Delete(':slug')
  @Auth('admin')
  remove(@Param('slug') slug: string, @AuthUser() user: IAuthUser) {
    return this.plansService.remove(slug, user.user._id.toString());
  }
}
