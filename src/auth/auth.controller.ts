import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Delete,
  Param,
  Res,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  Headers,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { type Response } from 'express';
import {
  singupBodyDto,
  loginBodyDto,
  ConfirmEmailDto,
  SendOtpDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  UpdateMeDto,
  ConfirmResetOtpDto,
  RefreshTokenDto,
  CreateAddressDto,
  UpdateAddressDto,
} from './dto/auth.dto';
import { Auth, AuthUser } from 'src/Common/Decorators';
import { type IAuthUser } from 'src/Common/Types';
import { performanceInterceptor } from 'src/Common/Interceptors/performance.interceptors';
import { FileInterceptor } from '@nestjs/platform-express';
import { uploadFileOptions } from 'src/Common/Utils/multer.utils';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ─── Existing Endpoints ──────────────────────────────────────────────────────

  @Post('signUp')
  async signUpHandler(@Body() body: singupBodyDto, @Res() res: Response) {
    const result = await this.authService.singup(body);
    res.status(HttpStatus.CREATED).json(result);
  }

  @Post('login')
  async loginHandler(@Body() body: loginBodyDto, @Res() res: Response) {
    const result = await this.authService.login(body);
    res.status(HttpStatus.OK).json(result);
  }

  @Get('me')
  @Auth('admin', 'customer')
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
  @Auth('admin', 'customer')
  async logoutHandler(@AuthUser() user: IAuthUser, @Res() res: Response) {
    await this.authService.logout(user);
    res.status(HttpStatus.OK).json({ message: 'Logout successfully' });
  }

  // ─── New Endpoints ───────────────────────────────────────────────────────────

  @Post('send-otp')
  async sendOtpHandler(@Body() body: SendOtpDto, @Res() res: Response) {
    const result = await this.authService.sendOtp(body);
    res.status(HttpStatus.OK).json(result);
  }

  @Post('forgot-password')
  async forgotPasswordHandler(
    @Body() body: ForgotPasswordDto,
    @Res() res: Response,
  ) {
    const result = await this.authService.forgotPassword(body);
    res.status(HttpStatus.OK).json(result);
  }

  @Post('generate-access-token')
  @Auth({
    roles: ['admin', 'customer', 'manager'],
    tokenType: 'refresh',
  })
  async generateAccessTokenHandler(
    @Res() res: Response,
    @AuthUser() user: IAuthUser,
  ) {
    const result = await this.authService.generateAccessToken(user);
    res.status(HttpStatus.OK).json(result);
  }

  @Patch('confirm-reset-otp')
  async confirmResetOtpHandler(
    @Body() body: ConfirmResetOtpDto,
    @Res() res: Response,
  ) {
    const result = await this.authService.confirmResetOtp(body);
    res.status(HttpStatus.OK).json(result);
  }

  @Patch('reset-password')
  async resetPasswordHandler(
    @Body() body: ResetPasswordDto,
    @Res() res: Response,
    @Headers('authorization') authHeader: string,
  ) {
    const result = await this.authService.resetPassword(body, authHeader);
    res.status(HttpStatus.OK).json(result);
  }

  @Patch('update-me')
  @Auth('admin', 'customer')
  @UseInterceptors(FileInterceptor('image', uploadFileOptions({})))
  async updateMeHandler(
    @AuthUser() user: IAuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UpdateMeDto,
    @Res() res: Response,
  ) {
    const result = await this.authService.updateMe(user, body, file);
    res.status(HttpStatus.OK).json(result);
  }

  // ─── Address Endpoints ──────────────────────────────────────────────────────

  @Post('addresses')
  @Auth('admin', 'customer')
  async addAddress(
    @AuthUser() user: IAuthUser,
    @Body() body: CreateAddressDto,
    @Res() res: Response,
  ) {
    const result = await this.authService.addAddress(user, body);
    res.status(HttpStatus.CREATED).json(result);
  }

  @Get('addresses')
  @Auth('admin', 'customer')
  async getAddresses(@AuthUser() user: IAuthUser, @Res() res: Response) {
    const result = await this.authService.getAddresses(user);
    res.status(HttpStatus.OK).json(result);
  }

  @Patch('addresses/:addressId')
  @Auth('admin', 'customer')
  async updateAddress(
    @AuthUser() user: IAuthUser,
    @Param('addressId') addressId: string,
    @Body() body: UpdateAddressDto,
    @Res() res: Response,
  ) {
    const result = await this.authService.updateAddress(user, addressId, body);
    res.status(HttpStatus.OK).json(result);
  }

  @Delete('addresses/:addressId')
  @Auth('admin', 'customer')
  async deleteAddress(
    @AuthUser() user: IAuthUser,
    @Param('addressId') addressId: string,
    @Res() res: Response,
  ) {
    const result = await this.authService.deleteAddress(user, addressId);
    res.status(HttpStatus.OK).json(result);
  }

  @Patch('addresses/:addressId/default')
  @Auth('admin', 'customer')
  async setDefaultAddress(
    @AuthUser() user: IAuthUser,
    @Param('addressId') addressId: string,
    @Res() res: Response,
  ) {
    const result = await this.authService.setDefaultAddress(user, addressId);
    res.status(HttpStatus.OK).json(result);
  }
}
