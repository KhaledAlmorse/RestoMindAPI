import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { WeeklyExecutiveSnapshot, WeeklyExecutiveSnapshotType } from '../Models/weekly-executive-snapshot.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class WeeklyExecutiveSnapshotRepository extends BaseService<WeeklyExecutiveSnapshotType> {
  constructor(
    @InjectModel(WeeklyExecutiveSnapshot.name)
    private readonly weeklySnapshotModel: Model<WeeklyExecutiveSnapshotType>,
  ) {
    super(weeklySnapshotModel);
  }
}
