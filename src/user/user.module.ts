import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { UserRepository } from 'src/DB/Repositories';
import { UserModel } from 'src/DB/Models';

@Module({
  imports: [UserModel],
  controllers: [UserController],
  providers: [UserService, UserRepository],
})
export class UserModule {}
