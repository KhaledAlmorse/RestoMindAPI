import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { type Response } from 'express';
import { type IAuthUser } from 'src/Common/Types';

import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // ─── POST /users ─────────────────────────────────────────────────────────────

  @Post()
  @Auth('admin', 'manager')
  async createUser(
    @AuthUser() user: IAuthUser,
    @Body() body: CreateUserDto,
    @Res() res: Response,
  ) {
    const result = await this.userService.createUser(body, user.user);
    res.status(HttpStatus.CREATED).json(result);
  }

  // ─── GET /users ───────────────────────────────────────────────────────────────

  @Get()
  @Auth('admin', 'manager')
  async findAll(
    @AuthUser() user: IAuthUser,
    @Query() query: QueryUserDto,
    @Res() res: Response,
  ) {
    const result = await this.userService.findAll(query, user.user);
    res.status(HttpStatus.OK).json(result);
  }

  // ─── GET /users/:id ──────────────────────────────────────────────────────────

  @Get(':id')
  @Auth('admin', 'manager')
  async findById(
    @Param('id') id: string,
    @AuthUser() user: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.userService.findById(id, user.user);
    res.status(HttpStatus.OK).json(result);
  }

  // ─── PATCH /users/:id ────────────────────────────────────────────────────────

  @Patch(':id')
  @Auth('admin', 'manager')
  async updateUser(
    @AuthUser() user: IAuthUser,
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
    @Res() res: Response,
  ) {
    const result = await this.userService.updateUser(id, body, user.user);
    res.status(HttpStatus.OK).json(result);
  }

  // ─── PATCH /users/:id/status ─────────────────────────────────────────────────

  @Patch(':id/status')
  @Auth('admin', 'manager')
  async updateStatus(
    @AuthUser() user: IAuthUser,
    @Param('id') id: string,
    @Body() body: UpdateUserStatusDto,
    @Res() res: Response,
  ) {
    const result = await this.userService.updateStatus(id, body, user.user);
    res.status(HttpStatus.OK).json(result);
  }

  // ─── POST /users/:id/resend-setup-email ─────────────────────────────────────

  @Post(':id/resend-setup-email')
  @Auth('admin', 'manager')
  async resendSetupEmail(
    @AuthUser() user: IAuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const result = await this.userService.resendSetupEmail(id, user.user);
    res.status(HttpStatus.OK).json(result);
  }

  // ─── POST /users/:id/reset-password ─────────────────────────────────────────

  @Post(':id/reset-password')
  @Auth('admin', 'manager')
  async resetPassword(
    @AuthUser() user: IAuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const result = await this.userService.resetPassword(id, user.user);
    res.status(HttpStatus.OK).json(result);
  }

  // ─── DELETE /users/:id ────────────────────────────────────────────────────────

  @Delete(':id')
  @Auth('admin', 'manager')
  async softDeleteUser(
    @AuthUser() user: IAuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const result = await this.userService.softDeleteUser(id, user.user);
    res.status(HttpStatus.OK).json(result);
  }
}
