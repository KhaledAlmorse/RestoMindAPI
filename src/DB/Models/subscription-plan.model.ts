import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

/**
 * Per-interval price in integer EGP cents.
 *
 * `null` means the interval is not sold — the billing screen hides it rather
 * than offering it at zero.
 */
@Schema({ _id: false })
export class PlanPrices {
  @Prop({ type: Number, default: null, min: 0 })
  monthly!: number | null;

  @Prop({ type: Number, default: null, min: 0 })
  halfYearly!: number | null;

  @Prop({ type: Number, default: null, min: 0 })
  yearly!: number | null;
}

const PlanPricesSchema = SchemaFactory.createForClass(PlanPrices);

/**
 * A purchasable capacity tier, replacing the hardcoded TIERS config.
 *
 * This model deliberately has no `ref` fields. If one is ever added it MUST
 * use `MongooseSchema.Types.ObjectId` — `Types.ObjectId` resolves to Mixed
 * under SchemaFactory and silently disables casting (see cart.model.ts).
 */
@Schema({ timestamps: true })
export class SubscriptionPlan {
  /** Immutable after create: it is a foreign key in restaurants and payments. */
  @Prop({
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  })
  slug!: string;

  @Prop({ type: String, required: true, trim: true })
  label!: string;

  /** null = unlimited. */
  @Prop({ type: Number, default: null, min: 1 })
  productCap!: number | null;

  @Prop({ type: PlanPricesSchema, required: true, default: () => ({}) })
  prices!: PlanPrices;

  @Prop({ type: Number, required: true, default: 0 })
  sortOrder!: number;

  /** Hidden from new buyers; existing holders keep it until their period ends. */
  @Prop({ type: Boolean, required: true, default: false })
  archived!: boolean;

  /** Exactly one plan carries this. Replaces the TRIAL_TIER constant. */
  @Prop({ type: Boolean, required: true, default: false })
  isTrialPlan!: boolean;
}

const SubscriptionPlanSchema = SchemaFactory.createForClass(SubscriptionPlan);
SubscriptionPlanSchema.index({ sortOrder: 1 });

export const SubscriptionPlanModel = MongooseModule.forFeature([
  { name: SubscriptionPlan.name, schema: SubscriptionPlanSchema },
]);

export type SubscriptionPlanType = HydratedDocument<SubscriptionPlan> & Document;
