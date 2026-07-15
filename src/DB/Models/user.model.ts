import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';
import { Encrypt, Hash } from 'src/Common/Security';
import { GenderEnum, RolesEnum } from 'src/Common/Types/types';

@Schema({ timestamps: true })
export class User {
  @Prop({ type: String, required: true, minLength: 3, maxLength: 20 })
  firstName!: string;
  @Prop({ type: String, required: true, minLength: 3, maxLength: 20 })
  lastName!: string;
  @Prop({
    type: String,
    required: true,
    // unique: true,
    lowercase: true,
    index: { name: 'unique_email_idx', unique: true },
  })
  email!: string;

  @Prop({ type: String, required: true, minLength: 6 })
  password!: string;
  @Prop({ type: String, enum: RolesEnum, default: RolesEnum.USER })
  role!: string;

  @Prop({ type: String, enum: GenderEnum })
  gender!: string;

  @Prop({ type: String, unique: true, required: true })
  phone!: string;

  @Prop({ type: Boolean, default: false })
  isEmailVerified!: boolean;

  @Prop({ type: Date })
  DOB!: Date;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;
}

const UserSchema = SchemaFactory.createForClass(User);

UserSchema.pre('save', function () {
  const changes = this.$getChanges()['$set'];
  if (changes.password) {
    const hashedPassword = Hash(changes.password);
    this.password = hashedPassword;
  }
  if (changes.phone) {
    this.phone = Encrypt(this.phone, process.env.Encryption_SECRET as string);
  }
});

export const UserModel = MongooseModule.forFeature([
  { name: User.name, schema: UserSchema },
]);

export type UserType = HydratedDocument<User> & Document;
