import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { ImportJobStatusEnum, ImportTypeEnum } from 'src/Common/Types';

@Schema({ _id: false })
export class ImportErrorDetail {
  @Prop({ type: Number, required: true })
  row!: number;

  @Prop({ type: String })
  column?: string;

  @Prop({ type: String, required: true })
  message!: string;
}

const ImportErrorDetailSchema = SchemaFactory.createForClass(ImportErrorDetail);

@Schema({ timestamps: true, suppressReservedKeysWarning: true })
export class ImportJob {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  uploadedBy!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(ImportTypeEnum),
    required: true,
  })
  importType!: ImportTypeEnum;

  @Prop({ type: String, required: true })
  fileName!: string;

  @Prop({ type: Object, default: {} })
  columnMapping?: Record<string, string>;

  @Prop({ type: [Array], default: [] })
  rawRows?: string[][];

  @Prop({
    type: String,
    enum: Object.values(ImportJobStatusEnum),
    required: true,
    default: ImportJobStatusEnum.PROCESSING,
  })
  status!: ImportJobStatusEnum;

  @Prop({ type: Number, default: 0 })
  totalRows?: number;

  @Prop({ type: Number, default: 0 })
  validRows?: number;

  @Prop({ type: Number, default: 0 })
  invalidRows?: number;

  @Prop({ type: [ImportErrorDetailSchema], default: [] })
  errors?: ImportErrorDetail[];

  @Prop({ type: Number, default: 0 })
  aiIngestAttempts!: number;

  @Prop({ type: String })
  aiIngestLastError?: string;

  @Prop({ type: String })
  failureReason?: string;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;
}

const ImportJobSchema = SchemaFactory.createForClass(ImportJob);

ImportJobSchema.index({ restaurantId: 1, createdAt: -1 });
ImportJobSchema.index({ status: 1 });

export const ImportJobModel = MongooseModule.forFeature([
  { name: ImportJob.name, schema: ImportJobSchema },
]);

export type ImportJobType = HydratedDocument<ImportJob> & Document;
