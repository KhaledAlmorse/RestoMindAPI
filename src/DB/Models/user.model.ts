import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { Decrypt, Hash } from 'src/Common/Security';
import { GenderEnum, RolesEnum } from 'src/Common/Types/types';

@Schema({ _id: true })
export class UserAddress {
  _id!: Types.ObjectId;

  @Prop({ type: String, required: false })
  label?: string;

  @Prop({ type: String, required: true })
  fullName!: string;

  @Prop({ type: String, required: true })
  phoneNumber!: string;

  @Prop({ type: String, required: true })
  street!: string;

  @Prop({ type: String, required: true })
  city!: string;

  @Prop({ type: String, required: false })
  country?: string;

  @Prop({ type: Boolean, default: false })
  isDefault!: boolean;
}

const UserAddressSchema = SchemaFactory.createForClass(UserAddress);

@Schema({
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
})
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
  @Prop({
    type: String,
    enum: Object.values(RolesEnum),
    default: RolesEnum.CUSTOMER,
  })
  role!: RolesEnum;

  @Prop({ type: String, enum: GenderEnum })
  gender!: GenderEnum;

  @Prop({
    type: String,
    unique: true,
    required: true,
    get: (value: string) => {
      if (!value) return value;
      try {
        return Decrypt(value, process.env.Encryption_SECRET as string);
      } catch {
        return value;
      }
    },
  })
  phone!: string;

  @Prop({ type: Boolean, default: false })
  isEmailVerified!: boolean;

  @Prop({ type: Date })
  DOB!: Date;

  @Prop({ type: Date })
  passwordChangedAt?: Date;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;

  @Prop({
    type: {
      public_id: { type: String, required: true },
      secure_url: { type: String, required: true },
    },
    _id: false,
    required: false,
  })
  image?: {
    public_id: string;
    secure_url: string;
  };

  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: false })
  restaurantId?: Types.ObjectId;

  @Prop({ type: [UserAddressSchema], default: [] })
  addresses!: UserAddress[];
}

const UserSchema = SchemaFactory.createForClass(User);

UserSchema.pre('save', function () {
  const changes = this.$getChanges()['$set'];
  if (changes) {
    if (changes.password) {
      const hashedPassword = Hash(changes.password);
      this.password = hashedPassword;
    }
  }
});

export const UserModel = MongooseModule.forFeature([
  { name: User.name, schema: UserSchema },
]);

export type UserType = HydratedDocument<User> & Document;
