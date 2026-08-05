import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Payment, PaymentType } from '../Models/payment.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class PaymentRepository extends BaseService<PaymentType> {
  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentType>,
  ) {
    super(paymentModel);
  }
}
