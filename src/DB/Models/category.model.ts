import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

@Schema({ timestamps: true })
export class Category {
  @Prop({ type: String, required: true, unique: true })
  name!: string;

  @Prop({ type: String, required: true })
  description!: string;

  @Prop({
    type: {
      public_id: { type: String, required: true },
      secure_url: { type: String, required: true },
    },
    _id: false,
    required: true,
  })
  image!: {
    public_id: string;
    secure_url: string;
  };

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;
}

const CategorySchema = SchemaFactory.createForClass(Category);

export const CategoryModel = MongooseModule.forFeature([
  { name: Category.name, schema: CategorySchema },
]);

export type CategoryType = HydratedDocument<Category> & Document;
