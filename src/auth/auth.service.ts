import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  OtpRepository,
  RevokeTokenRepository,
  UserRepository,
} from 'src/DB/Repositories';
import { ConfirmEmailDto, loginBodyDto, singupBodyDto } from './dto/auth.dto';
import { Events } from 'src/Common/Utils';
import { CompareHash, Hash } from 'src/Common/Security';
import { TokenService } from 'src/Common/Services';
import { v4 as uuidv4 } from 'uuid';
import type { StringValue } from 'ms';
import { IAuthUser, OtpTypeEnum } from 'src/Common/Types';

@Injectable()
export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly tokenService: TokenService,
    private readonly otpRepository: OtpRepository,
    private readonly revokeTokenRepository: RevokeTokenRepository,
  ) {}

  async singup(body: singupBodyDto) {
    const { firstName, lastName, email, password, phone, gender, DOB } = body;
    // Implementation for signing up a new user
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

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await this.otpRepository.createOtp({
      otp: Hash(otp),
      userId: newUser._id,
      otpType: OtpTypeEnum.CONFIRMATION,
    });

    // send email
    Events.emit('sendEmail', {
      to: email,
      subject: 'Email Verification',
      html: `Your OTP is ${otp}`,
    });

    return newUser;
  }

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

  getProfileData(user: IAuthUser) {
    const userData = this.userRepository.findOne({
      filters: { _id: user.user._id },
    });

    return userData;
  }

  async confirmEmail(body: ConfirmEmailDto) {
    const { otp, email } = body;
    const user = await this.userRepository.findOne({ filters: { email } });
    if (!user) {
      throw new NotFoundException(`User not found with this email `);
    }

    const existedOtp = await this.otpRepository.findOne({
      filters: { userId: user._id, otpType: OtpTypeEnum.CONFIRMATION },
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

    //* update the user Data
    await this.userRepository.update({
      filters: { _id: user._id },
      body: { isEmailVerified: true },
    });

    // delete otp
    await this.otpRepository.delete({ filters: { _id: existedOtp._id } });
    return;
  }

  async logout(user: IAuthUser) {
    //*
    return this.revokeTokenRepository.create({
      tokenId: user.token['jti'],
      userId: user.user._id,
      expiryTime: user.token['exp'],
    });
  }
}
