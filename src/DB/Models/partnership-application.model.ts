import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import {
  BusinessTypeEnum,
  PartnershipApplicationStatusEnum,
} from 'src/Common/Types';

@Schema({ timestamps: true })
export class PartnershipApplication {
  /** Public-facing reference id, e.g. RESTO-000123. Never expose _id instead — this is what the applicant sees and searches by. */
  @Prop({ type: String, required: true, unique: true })
  applicationId!: string;

  @Prop({ type: String, required: true })
  businessName!: string;

  @Prop({ type: String, enum: BusinessTypeEnum, required: true })
  businessType!: BusinessTypeEnum;

  @Prop({ type: String, required: false })
  description?: string;

  @Prop({ type: Number, required: false })
  estimatedOrdersPerDay?: number;

  @Prop({ type: Number, required: false })
  estimatedWasteKgPerDay?: number;

  @Prop({ type: String, required: true })
  ownerFirstName!: string;

  @Prop({ type: String, required: true })
  ownerLastName!: string;

  @Prop({ type: String, required: true })
  email!: string;

  @Prop({ type: String, required: true })
  phone!: string;

  @Prop({ type: String, required: true })
  city!: string;

  @Prop({ type: String, required: false })
  district?: string;

  @Prop({ type: String, required: false })
  street?: string;

  @Prop({ type: String, required: false })
  website?: string;

  @Prop({ type: String, required: false })
  facebookPage?: string;

  @Prop({ type: String, required: false })
  instagramPage?: string;

  @Prop({ type: Object, required: false })
  operatingHours?: Record<string, any>;

  @Prop({ type: String, required: false })
  commercialRegistration?: string;

  @Prop({ type: String, required: false })
  taxId?: string;

  @Prop({ type: String, required: false })
  notes?: string;

  @Prop({
    type: String,
    enum: PartnershipApplicationStatusEnum,
    default: PartnershipApplicationStatusEnum.PENDING,
  })
  status!: PartnershipApplicationStatusEnum;

  @Prop({ type: String, required: false })
  rejectionReason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  reviewedBy?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  approvedBy?: Types.ObjectId | null;

  @Prop({ type: Date, required: false })
  approvedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  userId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: false })
  restaurantId?: Types.ObjectId | null;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;

  @Prop({ type: Date })
  deletedAt?: Date;
}

const PartnershipApplicationSchema = SchemaFactory.createForClass(
  PartnershipApplication,
);

PartnershipApplicationSchema.index({ email: 1, status: 1 });
PartnershipApplicationSchema.index({ status: 1, createdAt: -1 });

export const PartnershipApplicationModel = MongooseModule.forFeature([
  { name: PartnershipApplication.name, schema: PartnershipApplicationSchema },
]);

export type PartnershipApplicationType =
  HydratedDocument<PartnershipApplication> & Document;
