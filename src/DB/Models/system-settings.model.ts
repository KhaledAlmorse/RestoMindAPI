import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

/**
 * Platform-wide switches an admin can flip without a deploy.
 *
 * Exactly one document ever exists — `key` is unique and always 'platform', so
 * a second insert fails loudly rather than creating a rival settings row that
 * half the code would read and the other half would not.
 */
@Schema({ timestamps: true })
export class SystemSettings {
  @Prop({ type: String, required: true, unique: true, default: 'platform' })
  key!: string;

  /** Whether a newly onboarded merchant is given a free trial at all. */
  @Prop({ type: Boolean, required: true, default: true })
  freeTrialEnabled!: boolean;

  /**
   * Length of a new trial. Changing it never moves a trial already granted —
   * those are stored as an absolute trialEndsAt, so nobody's clock jumps.
   */
  @Prop({ type: Number, required: true, default: 14, min: 1, max: 365 })
  trialDurationDays!: number;

  /**
   * The master early-bird switch. It gates both intake and pricing: turned off,
   * no newcomer claims a seat AND every existing early bird renews at the
   * standard price. The month they already paid for is untouched, because that
   * payment is already settled.
   */
  @Prop({ type: Boolean, required: true, default: true })
  earlyBirdEnabled!: boolean;

  /** How many merchants may claim the early-bird price automatically. */
  @Prop({ type: Number, required: true, default: 30, min: 0 })
  earlyBirdCap!: number;

  /**
   * One rate replacing the three per-tier earlyBirdEGP values, which were all
   * exactly a third off — the old config encoded a single rate three times.
   *
   * 33.3333 rather than 33.33: at 33.33 the Scale yearly price lands on
   * 10,001 EGP instead of 10,000. Combined with whole-EGP rounding in
   * planPriceCents() this reproduces every legacy price exactly.
   */
  @Prop({ type: Number, required: true, default: 33.3333, min: 0, max: 100 })
  earlyBirdDiscountPercent!: number;

  /**
   * Marketplace commission applied to a restaurant that has no commissionRate
   * of its own. A fraction (0.05 === 5%), the same unit as
   * Restaurant.commissionRate and Order.commissionRate, so no conversion ever
   * happens between the three — every percent lives in the UI layer only.
   *
   * Changing it affects orders created afterwards, never existing ones: each
   * Order snapshots the rate it was sold under.
   */
  @Prop({ type: Number, required: true, default: 0.05, min: 0, max: 1 })
  defaultCommissionRate!: number;
}

const SystemSettingsSchema = SchemaFactory.createForClass(SystemSettings);

export const SystemSettingsModel = MongooseModule.forFeature([
  { name: SystemSettings.name, schema: SystemSettingsSchema },
]);

export type SystemSettingsType = HydratedDocument<SystemSettings> & Document;
