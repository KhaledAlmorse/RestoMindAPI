import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { User } from './user.model';

@Schema({ timestamps: true })
export class RevokedToken {
  @Prop({ type: String, required: true })
  tokenId: string;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  userId: string | Types.ObjectId;

  @Prop({ type: Date, required: true })
  expiryTime: Date;
}

const RevokeTokenSchema = SchemaFactory.createForClass(RevokedToken);
export const RevokeTokenModel = MongooseModule.forFeature([
  { name: RevokedToken.name, schema: RevokeTokenSchema },
]);

export type RevokeTokenDocument = HydratedDocument<RevokedToken> & Document;
