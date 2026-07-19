import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { User } from './user.model';
import { OtpTypeEnum } from 'src/Common/Types';

@Schema({ timestamps: true })
export class Otp {
  @Prop({ type: String, required: true })
  otp: string;
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  userId: string | Types.ObjectId;
  @Prop({ type: Date, required: true })
  expireTime: Date;
  @Prop({ type: String, enum: OtpTypeEnum, required: true })
  otpType: OtpTypeEnum;
}

const OtpSchema = SchemaFactory.createForClass(Otp);

export const OtpModel = MongooseModule.forFeature([
  { name: Otp.name, schema: OtpSchema },
]);

export type OtpType = HydratedDocument<Otp> & Document;
