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
import {
  getBusinessDateString,
  getBusinessDayRange,
} from 'src/Common/Utils/date.util';

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

  async getSummary(userId: string) {
    const restaurantId = await this.getManagerRestaurantId(userId);

    // The summary is a snapshot of the LATEST scan, not a running total.
    // scanSurplus writes one report per ingredient per day, so aggregating
    // every report ever written both degrades linearly and multiplies
    // totalEstimatedWasteCost by the number of days scanned.
    // `limit: 1` — the previous `findMany` loaded the whole collection just to
    // read element [0].
    const { items } = await this.wasteReportRepository.findManyPaginated({
      filters: { restaurantId, isDeleted: false },
      skip: 0,
      limit: 1,
      sort: 'createdAt',
      order: 'desc',
    });
    const latestReport = items[0] ?? null;

    if (!latestReport) {
      return {
        restaurantId,
        scanDate: null,
        totalReports: 0,
        totalSurplusQuantity: 0,
        totalEstimatedWasteCost: 0,
        riskBreakdown: {
          high: 0,
          medium: 0,
          low: 0,
        },
        reports: [],
      };
    }

    // The scan day is a CAIRO day. `setHours(0,0,0,0)` used the server's local
    // day, so on a UTC container the window was offset by 2-3 hours and picked
    // up the tail of the neighbouring Cairo day's scan.
    const scanDate = getBusinessDateString(
      (latestReport as any).createdAt || new Date(),
    );
    const { start: scanDayStart, end: scanDayEnd } =
      getBusinessDayRange(scanDate);

    const pipeline = [
      {
        $match: {
          restaurantId: new Types.ObjectId(restaurantId.toString()),
          isDeleted: false,
          createdAt: { $gte: scanDayStart, $lt: scanDayEnd },
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
      scanDate,
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
