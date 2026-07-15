import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Otp, type OtpType } from '../Models/otp.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OtpTypeEnum } from 'src/Common/Types/types';
import { Hash } from 'src/Common/Security';

interface ICreateOptions {
  userId: Types.ObjectId;
  otp: string;
  otpType: OtpTypeEnum;
  expireTime?: Date;
}

@Injectable()
export class OtpRepository extends BaseService<OtpType> {
  constructor(
    @InjectModel(Otp.name) private readonly otpModel: Model<OtpType>,
  ) {
    super(otpModel);
  }

  async createOtp(options: ICreateOptions) {
    const { otpType, otp, userId, expireTime } = options;
    return await this.create({
      userId,
      otp: Hash(otp),
      otpType,
      expireTime: expireTime || new Date(Date.now() + 10 * 60 * 1000),
    });
  }
}
