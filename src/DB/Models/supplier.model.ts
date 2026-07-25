import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Supplier {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, default: '', trim: true })
  email?: string;

  @Prop({ type: String, default: '', trim: true })
  phone?: string;

  @Prop({ type: Number, required: true, default: 1, min: 0 })
  leadTimeDays!: number;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date;
}

const SupplierSchema = SchemaFactory.createForClass(Supplier);

SupplierSchema.index({ restaurantId: 1, isDeleted: 1 });
SupplierSchema.index(
  { restaurantId: 1, name: 1 },
  { partialFilterExpression: { isDeleted: false } },
);

export const SupplierModel = MongooseModule.forFeature([
  { name: Supplier.name, schema: SupplierSchema },
]);

export type SupplierType = HydratedDocument<Supplier> & Document;
