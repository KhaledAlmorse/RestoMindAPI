import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { OrderGroup, OrderGroupType } from '../Models/order-group.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class OrderGroupRepository extends BaseService<OrderGroupType> {
  constructor(
    @InjectModel(OrderGroup.name)
    private readonly orderGroupModel: Model<OrderGroupType>,
  ) {
    super(orderGroupModel);
  }
}
