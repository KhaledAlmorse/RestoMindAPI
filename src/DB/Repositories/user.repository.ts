import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { User, type UserType, UserModel } from '../Models/user.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class UserRepository extends BaseService<UserType> {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserType>,
  ) {
    super(userModel);
  }

  //* if you need to add any custom methods for the user repository, you can do it here such as findByEmail, findByUserName, etc.
}
