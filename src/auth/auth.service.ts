import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  OtpRepository,
  RevokeTokenRepository,
  UserRepository,
} from 'src/DB/Repositories';
import {
  ConfirmEmailDto,
  ConfirmResetOtpDto,
  ForgetPasswordDto,
  loginBodyDto,
  ResetPasswordDto,
  SendOtpDto,
  singupBodyDto,
  UpdateMeDto,
  UpdatePasswordDto,
} from './dto/auth.dto';
import { Events } from 'src/Common/Utils';
import { CompareHash, Hash } from 'src/Common/Security';
import { TokenService } from 'src/Common/Services';
import { v4 as uuidv4 } from 'uuid';
import type { StringValue } from 'ms';
import { IAuthUser, OtpTypeEnum } from 'src/Common/Types';
import { Types } from 'mongoose';

@Injectable()
export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly tokenService: TokenService,
    private readonly otpRepository: OtpRepository,
    private readonly revokeTokenRepository: RevokeTokenRepository,
  ) {}

  // ─── Private Helper ──────────────────────────────────────────────────────────

  /**
   * Reusable OTP logic:
   * 1. Delete any previous OTPs for this user+type
   * 2. Generate a new 6-digit OTP
   * 3. Hash & save it
   * 4. Send plain OTP via email
   */
  private async generateAndSendOtp(
    userId: Types.ObjectId,
    email: string,
    otpType: OtpTypeEnum,
  ) {
    // Delete previous OTPs of the same type for this user
    await this.otpRepository.deleteMany({ filters: { userId, otpType } });

    // Generate plain OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Save hashed OTP (hashing is done inside createOtp)
    await this.otpRepository.createOtp({
      otp,
      userId,
      otpType,
    });

    // Send plain OTP by email
    Events.emit('sendEmail', {
      to: email,
      subject:
        otpType === OtpTypeEnum.CONFIRMATION
          ? 'Email Verification'
          : 'Password Reset OTP',
      html: `Your OTP is <strong>${otp}</strong>. It expires in 10 minutes.`,
    });
  }

  // ─── Signup ──────────────────────────────────────────────────────────────────

  async singup(body: singupBodyDto) {
    const { firstName, lastName, email, password, phone, gender, DOB } = body;

    const user = await this.userRepository.findOne({ filters: { email } });
    if (user) {
      throw new ConflictException('User already exists');
    }

    const newUser = await this.userRepository.create({
      firstName,
      lastName,
      email,
      password,
      phone,
      gender,
      DOB,
    });

    await this.generateAndSendOtp(newUser._id, email, OtpTypeEnum.CONFIRMATION);
    return newUser;
  }

  // ─── Login ───────────────────────────────────────────────────────────────────

  async login(body: loginBodyDto) {
    const { email, password } = body;
    const user = await this.userRepository.findOne({ filters: { email } });

    if (!user) {
      throw new ConflictException('Invalid Email or password');
    }

    const comparePassword = CompareHash(password, user.password);
    if (!comparePassword) {
      throw new ConflictException('Invalid Email or password');
    }

    if (!user.isEmailVerified) {
      throw new BadRequestException('Please confirm your email first');
    }

    const tokenPayload = { id: user._id, email: user.email };
    const accessToken = this.tokenService.generate(tokenPayload, {
      secret: process.env.ACCESS_TOKEN_SECRET,
      expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN as StringValue,
      jwtid: uuidv4(),
    });

    const refreshToken = this.tokenService.generate(tokenPayload, {
      secret: process.env.REFRESH_TOKEN_SECRET,
      expiresIn: process.env.REFRESH_EXPIRES_IN as StringValue,
      jwtid: uuidv4(),
    });

    return { accessToken, refreshToken };
  }

  // ─── Get Profile ─────────────────────────────────────────────────────────────

  getProfileData(user: IAuthUser) {
    return this.userRepository.findOne({
      filters: { _id: user.user._id },
    });
  }

  // ─── Confirm Email ───────────────────────────────────────────────────────────

  async confirmEmail(body: ConfirmEmailDto) {
    const { otp, email } = body;
    const userData = await this.userRepository.findOne({
      filters: { email },
    });
    if (!userData) {
      throw new NotFoundException(`User not found with this email`);
    }

    const existedOtp = await this.otpRepository.findOne({
      filters: { userId: userData._id, otpType: OtpTypeEnum.CONFIRMATION },
    });
    if (!existedOtp) {
      throw new NotFoundException(`Otp not found with this email`);
    }

    if (!CompareHash(otp, existedOtp.otp)) {
      throw new NotFoundException(`Invalid Otp`);
    }

    if (existedOtp.expireTime < new Date(Date.now())) {
      throw new BadRequestException('OTP has been expired');
    }

    await this.userRepository.update({
      filters: { _id: userData._id },
      body: { isEmailVerified: true },
    });

    await this.otpRepository.delete({ filters: { _id: existedOtp._id } });
  }

  // ─── Logout ──────────────────────────────────────────────────────────────────

  async logout(user: IAuthUser) {
    return this.revokeTokenRepository.create({
      tokenId: user.token['jti'],
      userId: user.user._id,
      expiryTime: user.token['exp'],
    });
  }

  // ─── Send OTP ────────────────────────────────────────────────────────────────

  async sendOtp(body: SendOtpDto) {
    const { email, type } = body;

    const user = await this.userRepository.findOne({ filters: { email } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (type === OtpTypeEnum.CONFIRMATION) {
      if (user.isEmailVerified) {
        throw new ConflictException('Email already verified');
      }
    }

    await this.generateAndSendOtp(user._id, email, type);

    return { message: 'OTP sent successfully' };
  }

  // ─── Forget Password ─────────────────────────────────────────────────────────

  async forgetPassword(body: ForgetPasswordDto) {
    const { email } = body;

    const user = await this.userRepository.findOne({ filters: { email } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.generateAndSendOtp(user._id, email, OtpTypeEnum.RESET_PASSWORD);

    return { message: 'OTP sent successfully' };
  }

  async confirmResetOtp(body: ConfirmResetOtpDto, user: IAuthUser) {
    const { otp } = body;

    const existedOtp = await this.otpRepository.findOne({
      filters: { userId: user.user._id, otpType: OtpTypeEnum.RESET_PASSWORD },
    });
    if (!existedOtp) {
      throw new NotFoundException('OTP not found');
    }

    if (existedOtp.expireTime < new Date(Date.now())) {
      throw new BadRequestException('OTP has been expired');
    }

    if (!CompareHash(otp, existedOtp.otp)) {
      throw new BadRequestException('Invalid OTP');
    }

    await this.otpRepository.delete({ filters: { _id: existedOtp._id } });

    return { message: 'Reset OTP confirmed successfully' };
  }

  // ─── Reset Password ──────────────────────────────────────────────────────────

  async resetPassword(body: ResetPasswordDto, user: IAuthUser) {
    const { password, confirmPassword } = body;

    if (password !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const HashPassword = Hash(password);

    await this.userRepository.update({
      filters: { _id: user.user._id },
      body: { password: HashPassword },
    });

    await this.revokeTokenRepository.deleteMany({
      filters: { userId: user.user._id },
    });

    return { message: 'Password reset successfully, Now login again' };
  }

  // ─── Update Me ───────────────────────────────────────────────────────────────

  async updateMe(user: IAuthUser, body: UpdateMeDto) {
    const updatedUser = await this.userRepository.update({
      filters: { _id: user.user._id },
      body,
    });

    return updatedUser;
  }

  async generateAccessToken(authUser: IAuthUser) {
    const { user, token } = authUser;
    const isTokenRevoked = await this.revokeTokenRepository.findOne({
      filters: { tokenId: token['jti'] },
    });

    if (isTokenRevoked) {
      throw new UnauthorizedException('Token has been revoked');
    }

    const tokenPayload = { id: user._id, email: user.email };
    const accessToken = this.tokenService.generate(tokenPayload, {
      secret: process.env.ACCESS_TOKEN_SECRET,
      expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN as StringValue,
      jwtid: uuidv4(),
    });

    return { accessToken };
  }
}
