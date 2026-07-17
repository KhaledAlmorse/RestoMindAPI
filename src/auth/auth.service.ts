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
  ForgotPasswordDto,
  loginBodyDto,
  ResetPasswordDto,
  SendOtpDto,
  singupBodyDto,
  UpdateMeDto,
  UpdatePasswordDto,
} from './dto/auth.dto';
import { Events } from 'src/Common/Utils';
import { CompareHash, Hash } from 'src/Common/Security';
import { TokenService, UploadCloudFileService } from 'src/Common/Services';
import { randomUUID } from 'crypto';
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
    private readonly uploadCloudFileService: UploadCloudFileService,
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
      jwtid: randomUUID(),
    });

    const refreshToken = this.tokenService.generate(tokenPayload, {
      secret: process.env.REFRESH_TOKEN_SECRET,
      expiresIn: process.env.REFRESH_EXPIRES_IN as StringValue,
      jwtid: randomUUID(),
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

  async forgotPassword(body: ForgotPasswordDto) {
    const { email } = body;

    const user = await this.userRepository.findOne({ filters: { email } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.generateAndSendOtp(user._id, email, OtpTypeEnum.RESET_PASSWORD);

    return { message: 'OTP sent successfully' };
  }

  async confirmResetOtp(body: ConfirmResetOtpDto) {
    const { email, otp } = body;

    const user = await this.userRepository.findOne({ filters: { email } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const existedOtp = await this.otpRepository.findOne({
      filters: { userId: user._id, otpType: OtpTypeEnum.RESET_PASSWORD },
    });
    if (!existedOtp) {
      throw new NotFoundException('OTP not found');
    }

    if (existedOtp.expireTime < new Date(Date.now())) {
      throw new BadRequestException('OTP has expired');
    }

    if (!CompareHash(otp, existedOtp.otp)) {
      throw new BadRequestException('Invalid OTP');
    }

    await this.otpRepository.delete({ filters: { _id: existedOtp._id } });

    // Generate a short-lived Reset Token (JWT) dedicated only for password reset (5-10 minutes)
    const resetToken = this.tokenService.generate(
      { id: user._id, email: user.email, type: 'RESET_PASSWORD' },
      {
        secret:
          process.env.RESET_PASSWORD_TOKEN_SECRET || 'default-reset-secret-key',
        expiresIn: (process.env.RESET_PASSWORD_EXPIRES_IN ||
          '10m') as StringValue,
        jwtid: randomUUID(),
      },
    );

    return {
      message: 'OTP verified successfully',
      resetToken,
    };
  }

  // ─── Reset Password ──────────────────────────────────────────────────────────

  async resetPassword(body: ResetPasswordDto, authHeader?: string) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No reset token provided');
    }
    const token = authHeader.split(' ')[1];

    let decoded: any;
    try {
      decoded = this.tokenService.verify(token, {
        secret:
          process.env.RESET_PASSWORD_TOKEN_SECRET || 'default-reset-secret-key',
      });
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    if (decoded.type !== 'RESET_PASSWORD') {
      throw new UnauthorizedException('Invalid reset token type');
    }

    const isTokenRevoked = await this.revokeTokenRepository.findOne({
      filters: { tokenId: decoded.jti },
    });
    if (isTokenRevoked) {
      throw new UnauthorizedException('Reset token has already been used');
    }

    const { password, confirmPassword } = body;

    if (password !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const userId = decoded.id;
    const HashPassword = Hash(password);

    const updatedUser = await this.userRepository.update({
      filters: { _id: userId },
      body: {
        password: HashPassword,
        passwordChangedAt: new Date(),
      } as any,
    });

    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    // Delete any remaining Reset OTPs for this user
    await this.otpRepository.deleteMany({
      filters: { userId, otpType: OtpTypeEnum.RESET_PASSWORD },
    });

    // Invalidate the Reset Token after use
    await this.revokeTokenRepository.create({
      tokenId: decoded.jti,
      userId,
      expiryTime: new Date(decoded.exp * 1000),
    });

    return { message: 'Password reset successfully, Now login again' };
  }

  async updateMe(
    user: IAuthUser,
    body: UpdateMeDto,
    file?: Express.Multer.File,
  ) {
    const existingUser = await this.userRepository.findOne({
      filters: { _id: user.user._id },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    const updateData: any = { ...body };

    if (file) {
      if (existingUser.image && existingUser.image.public_id) {
        await this.uploadCloudFileService.DeleteFileByPublicId(
          existingUser.image.public_id,
        );
      }
      const uploadResult = await this.uploadCloudFileService.uploadFile(
        file.path,
        {
          folder: `${process.env.CLOUD_FOLDER_NAME}/users/${user.user._id.toString()}`,
        },
      );
      updateData.image = uploadResult;
    }

    const updatedUser = await this.userRepository.update({
      filters: { _id: user.user._id },
      body: updateData,
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
      jwtid: randomUUID(),
    });

    return { accessToken };
  }
}
