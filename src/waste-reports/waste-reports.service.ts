import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isValidObjectId, Types } from 'mongoose';
import {
  IngredientRepository,
  RestaurantRepository,
  UserRepository,
  WasteReportRepository,
} from 'src/DB/Repositories';
import { QueryWasteReportDto } from './dto/query-waste-report.dto';
import { RiskLevelEnum } from 'src/Common/Types';

@Injectable()
export class WasteReportsService {
  constructor(
    private readonly wasteReportRepository: WasteReportRepository,
    private readonly userRepository: UserRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly ingredientRepository: IngredientRepository,
  ) {}

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  private async getManagerRestaurantId(
    userId: string,
  ): Promise<Types.ObjectId> {
    this.validateObjectId(userId);
    const user = await this.userRepository.findOne({
      filters: { _id: new Types.ObjectId(userId), isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.restaurantId) {
      return new Types.ObjectId(user.restaurantId.toString());
    }

    const restaurant = await this.restaurantRepository.findOne({
      filters: { ownerUserId: new Types.ObjectId(userId), isDeleted: false },
    });

    if (!restaurant) {
      throw new ForbiddenException(
        'You are not assigned to a restaurant or do not own one',
      );
    }

    return restaurant._id;
  }

  async findAll(userId: string, query: QueryWasteReportDto) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const filters: Record<string, any> = {
      restaurantId,
      isDeleted: false,
    };

    if (query.riskLevel) {
      filters.riskLevel = query.riskLevel;
    }

    if (query.ingredientId) {
      this.validateObjectId(query.ingredientId);
      filters.ingredientId = new Types.ObjectId(query.ingredientId);
    }

    return this.wasteReportRepository.findManyPaginated({
      filters,
      skip,
      limit,
      sort: 'createdAt',
      order: 'desc',
      populationArray: [
        { path: 'ingredientId', select: 'name unit costPerUnit' },
        // Prediction has `targetWeek` and `source`. The old names matched no
        // field, so this populate always returned bare _ids.
        {
          path: 'predictionId',
          select: 'targetWeek source predictedOrders confidence modelVersionId',
        },
      ],
    });
  }

  async getSummary(userId: string, days = 30) {
    const restaurantId = await this.getManagerRestaurantId(userId);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - Math.abs(days));

    const pipeline = [
      {
        $match: {
          restaurantId: new Types.ObjectId(restaurantId.toString()),
          isDeleted: false,
          // scanSurplus writes one report per ingredient per day, so an
          // unbounded aggregation degrades linearly forever.
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: '$ingredientId',
          totalExpectedConsumption: { $sum: '$expectedConsumption' },
          totalUsableStock: { $sum: '$usableAvailableStock' },
          totalExpectedSurplus: { $sum: '$expectedSurplus' },
          riskLevels: { $addToSet: '$riskLevel' },
        },
      },
      {
        $lookup: {
          from: 'ingredients',
          localField: '_id',
          foreignField: '_id',
          as: 'ingredient',
        },
      },
      { $unwind: { path: '$ingredient', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          highestRiskLevel: {
            $cond: [
              { $in: [RiskLevelEnum.HIGH, '$riskLevels'] },
              RiskLevelEnum.HIGH,
              {
                $cond: [
                  { $in: [RiskLevelEnum.MEDIUM, '$riskLevels'] },
                  RiskLevelEnum.MEDIUM,
                  RiskLevelEnum.LOW,
                ],
              },
            ],
          },
        },
      },
      {
        $project: {
          _id: 0,
          ingredient: {
            name: '$ingredient.name',
            unit: '$ingredient.unit',
            costPerUnit: '$ingredient.costPerUnit',
          },
          totalExpectedConsumption: 1,
          totalUsableStock: 1,
          totalExpectedSurplus: 1,
          highestRiskLevel: 1,
        },
      },
    ];

    const aggregatedReports =
      await this.wasteReportRepository.aggregate(pipeline);

    const totalSurplusQuantity = aggregatedReports.reduce(
      (sum, r) => sum + r.totalExpectedSurplus,
      0,
    );

    const totalEstimatedWasteCost =
      Math.round(
        aggregatedReports.reduce(
          (sum, r) =>
            sum +
            (r.totalExpectedSurplus || 0) * (r.ingredient?.costPerUnit || 0),
          0,
        ) * 100,
      ) / 100;

    const highRiskCount = aggregatedReports.filter(
      (r) => r.highestRiskLevel === RiskLevelEnum.HIGH,
    ).length;
    const mediumRiskCount = aggregatedReports.filter(
      (r) => r.highestRiskLevel === RiskLevelEnum.MEDIUM,
    ).length;
    const lowRiskCount = aggregatedReports.filter(
      (r) => r.highestRiskLevel === RiskLevelEnum.LOW,
    ).length;

    return {
      restaurantId,
      windowDays: days,
      totalReports: aggregatedReports.length,
      totalSurplusQuantity,
      totalEstimatedWasteCost,
      riskBreakdown: {
        high: highRiskCount,
        medium: mediumRiskCount,
        low: lowRiskCount,
      },
      reports: aggregatedReports,
    };
  }
}
