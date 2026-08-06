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
}

const SystemSettingsSchema = SchemaFactory.createForClass(SystemSettings);

export const SystemSettingsModel = MongooseModule.forFeature([
  { name: SystemSettings.name, schema: SystemSettingsSchema },
]);

export type SystemSettingsType = HydratedDocument<SystemSettings> & Document;
