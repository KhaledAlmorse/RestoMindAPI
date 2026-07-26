import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { IngredientUnitEnum, PurchaseOrderStatusEnum, PurchaseOrderSourceEnum } from 'src/Common/Types';

@Schema({ _id: false })
export class PurchaseOrderItem {
  @Prop({ type: Types.ObjectId, ref: 'Ingredient', required: true })
  ingredientId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  quantity!: number;

  @Prop({
    type: String,
    enum: Object.values(IngredientUnitEnum),
    required: true,
  })
  unit!: IngredientUnitEnum;

  @Prop({ type: Number, required: true, min: 0 })
  unitCost!: number;
}

const PurchaseOrderItemSchema =
  SchemaFactory.createForClass(PurchaseOrderItem);

@Schema({ timestamps: true })
export class PurchaseOrder {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Supplier', required: true })
  supplierId!: Types.ObjectId;

  @Prop({ type: [PurchaseOrderItemSchema], required: true, default: [] })
  items!: PurchaseOrderItem[];

  @Prop({
    type: String,
    enum: Object.values(PurchaseOrderStatusEnum),
    required: true,
    default: PurchaseOrderStatusEnum.DRAFT,
  })
  status!: PurchaseOrderStatusEnum;

  @Prop({
    type: String,
    enum: Object.values(PurchaseOrderSourceEnum),
    default: PurchaseOrderSourceEnum.MANUAL,
  })
  source?: PurchaseOrderSourceEnum;

  @Prop({ type: Date, default: null })
  expectedDeliveryDate?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date;
}

const PurchaseOrderSchema = SchemaFactory.createForClass(PurchaseOrder);

PurchaseOrderSchema.index({ restaurantId: 1, isDeleted: 1 });
PurchaseOrderSchema.index({ restaurantId: 1, status: 1 });
PurchaseOrderSchema.index({ supplierId: 1 });

export const PurchaseOrderModel = MongooseModule.forFeature([
  { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
]);

export type PurchaseOrderType = HydratedDocument<PurchaseOrder> & Document;
