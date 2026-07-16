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
import { Auth } from 'src/Common/Decorators';
import { type Response } from 'express';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // ─── POST /users ─────────────────────────────────────────────────────────────

  @Post()
  @Auth('admin', 'manager')
  async createUser(@Body() body: CreateUserDto, @Res() res: Response) {
    const result = await this.userService.createUser(body);
    res.status(HttpStatus.CREATED).json(result);
  }

  // ─── GET /users ───────────────────────────────────────────────────────────────

  @Get()
  @Auth('admin', 'manager')
  async findAll(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('search') search: string,
    @Query('role') role: string,
    @Query('sort') sort: string,
    @Query('order') order: 'asc' | 'desc',
    @Res() res: Response,
  ) {
    const result = await this.userService.findAll({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 10,
      search,
      role,
      sort,
      order,
    });
    res.status(HttpStatus.OK).json(result);
  }

  // ─── GET /users/:id ──────────────────────────────────────────────────────────

  @Get(':id')
  @Auth('admin', 'manager')
  async findById(@Param('id') id: string, @Res() res: Response) {
    const result = await this.userService.findById(id);
    res.status(HttpStatus.OK).json(result);
  }

  // ─── PATCH /users/:id ────────────────────────────────────────────────────────

  @Patch(':id')
  @Auth('admin', 'manager')
  async updateUser(
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
    @Res() res: Response,
  ) {
    const result = await this.userService.updateUser(id, body);
    res.status(HttpStatus.OK).json(result);
  }

  // ─── DELETE /users/:id ────────────────────────────────────────────────────────

  @Delete(':id')
  @Auth('admin')
  async softDeleteUser(@Param('id') id: string, @Res() res: Response) {
    const result = await this.userService.softDeleteUser(id);
    res.status(HttpStatus.OK).json(result);
  }
}
