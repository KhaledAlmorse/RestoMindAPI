import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Res,
  HttpStatus,
  UseGuards,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { type Request, type Response } from 'express';
import { singupBodyDto, loginBodyDto, ConfirmEmailDto } from './dto/auth.dto';
import { AuthGuard, RolesGuard } from 'src/Common/Guards';
import { Auth, AuthUser, Roles } from 'src/Common/Decorators';
import { type UserType } from 'src/DB/Models';
import { type IAuthUser } from 'src/Common/Types';
import { performanceInterceptor } from 'src/Common/Interceptors/performance.interceptors';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('singup')
  async singupHandler(@Body() body: singupBodyDto, @Res() res: Response) {
    const result = await this.authService.singup(body);
    res.status(HttpStatus.CREATED).json(result);
  }

  @Post('login')
  async loginHandler(@Body() body: loginBodyDto, @Res() res: Response) {
    const result = await this.authService.login(body);
    res.status(HttpStatus.OK).json(result);
  }

  @Get('me')
  @Auth('admin', 'user')
  @UseInterceptors(performanceInterceptor)
  async getMe(@AuthUser() user: IAuthUser, @Res() res: Response) {
    const result = await this.authService.getProfileData(user);
    res.status(HttpStatus.OK).json(result);
  }

  @Patch('confirm-email')
  async confirmEmailHandler(
    @Body() body: ConfirmEmailDto,
    @Res() res: Response,
  ) {
    await this.authService.confirmEmail(body);
    res.status(HttpStatus.OK).json({ message: 'Email confirmed successfully' });
  }

  @Post('logout')
  @Auth('admin', 'user')
  async logoutHandler(@AuthUser() user: IAuthUser, @Res() res: Response) {
    await this.authService.logout(user);
    res.status(HttpStatus.OK).json({ message: 'Logout successfully' });
  }
}
