import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { AuthGuard } from 'src/Common/Guards/auth.guard';
import {
  UserRepository,
  OtpRepository,
  RevokeTokenRepository,
} from 'src/DB/Repositories';
import { TokenService, UploadCloudFileService } from 'src/Common/Services';
import { Reflector } from '@nestjs/core';
import { UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';

describe('AuthService & AuthGuard - Token Lifecycle Security', () => {
  let authService: AuthService;
  let authGuard: AuthGuard;

  let userRepositoryMock: any;
  let tokenServiceMock: any;
  let otpRepositoryMock: any;
  let revokeTokenRepositoryMock: any;
  let uploadCloudFileServiceMock: any;
  let reflectorMock: any;

  const mockUserId = new Types.ObjectId();
  const mockUser: any = {
    _id: mockUserId,
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    password: bcrypt.hashSync('password123', 10),
    isActive: true,
    isEmailVerified: true,
  };

  const revokedTokenSet = new Set<string>();

  beforeEach(async () => {
    revokedTokenSet.clear();

    userRepositoryMock = {
      findOne: jest.fn().mockImplementation(({ filters }) => {
        if (filters._id && filters._id.toString() === mockUserId.toString()) {
          return Promise.resolve(mockUser);
        }
        if (filters.email && filters.email === mockUser.email) {
          return Promise.resolve(mockUser);
        }
        return Promise.resolve(null);
      }),
      update: jest.fn().mockImplementation(({ filters, body }) => {
        if (body.tokensRevokedAt) {
          mockUser.tokensRevokedAt = body.tokensRevokedAt;
        }
        return Promise.resolve(mockUser);
      }),
    };

    tokenServiceMock = {
      generate: jest.fn().mockImplementation((payload, options) => {
        const secret = options?.secret || 'secret';
        const jti = options?.jwtid || 'mock-jti';
        return `jwt.${secret}.${payload.id}.${jti}.${options?.expiresIn || '15m'}`;
      }),
      verify: jest.fn().mockImplementation((token, options) => {
        if (token === 'expired-token') {
          throw new Error('jwt expired');
        }
        const parts = token.split('.');
        if (parts.length >= 4) {
          const secret = parts[1];
          const userId = parts[2];
          const jti = parts[3];
          if (options?.secret && options.secret !== secret) {
            throw new Error('invalid signature');
          }
          return {
            id: userId,
            email: 'john@example.com',
            jti,
            iat: Math.floor(Date.now() / 1000) - 10,
            exp: Math.floor(Date.now() / 1000) + 3600,
          };
        }
        return {
          id: mockUserId.toString(),
          email: mockUser.email,
          jti: 'mock-jti-default',
          iat: Math.floor(Date.now() / 1000) - 10,
          exp: Math.floor(Date.now() / 1000) + 3600,
        };
      }),
    };

    otpRepositoryMock = {};

    revokeTokenRepositoryMock = {
      create: jest.fn().mockImplementation((data) => {
        revokedTokenSet.add(data.tokenId);
        return Promise.resolve(data);
      }),
      findOne: jest.fn().mockImplementation(({ filters }) => {
        if (filters.tokenId && revokedTokenSet.has(filters.tokenId)) {
          return Promise.resolve({ tokenId: filters.tokenId });
        }
        return Promise.resolve(null);
      }),
    };

    uploadCloudFileServiceMock = {};
    reflectorMock = {
      getAllAndOverride: jest.fn().mockReturnValue('access'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        AuthGuard,
        { provide: UserRepository, useValue: userRepositoryMock },
        { provide: TokenService, useValue: tokenServiceMock },
        { provide: OtpRepository, useValue: otpRepositoryMock },
        { provide: RevokeTokenRepository, useValue: revokeTokenRepositoryMock },
        { provide: UploadCloudFileService, useValue: uploadCloudFileServiceMock },
        { provide: Reflector, useValue: reflectorMock },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    authGuard = module.get<AuthGuard>(AuthGuard);
    delete mockUser.tokensRevokedAt;
  });

  function createMockExecutionContext(token: string, tokenType: 'access' | 'refresh' = 'access') {
    reflectorMock.getAllAndOverride.mockReturnValue(tokenType);
    const req: any = {
      headers: {
        authorization: token ? `Bearer ${token}` : undefined,
      },
    };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
      req,
    } as unknown as ExecutionContext;
  }

  // ─── TEST 1 — Login ────────────────────────────────────────────────────────
  it('TEST 1 — Login generates Access Token + Refresh Token and returns token pair', async () => {
    const result = await authService.login({
      email: mockUser.email,
      password: 'password123',
    });

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(tokenServiceMock.generate).toHaveBeenCalledTimes(2);
  });

  // ─── TEST 2 — Successful Refresh (RTR) ─────────────────────────────────────
  it('TEST 2 — Successful Refresh invalidates old Refresh Token and generates new Access Token + new Refresh Token', async () => {
    const oldRefreshJti = 'refresh-jti-1';

    const authUser: any = {
      user: mockUser,
      token: {
        id: mockUserId.toString(),
        jti: oldRefreshJti,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    };

    const result = await authService.generateAccessToken(authUser);

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');

    // Verify old refresh token was revoked
    expect(revokeTokenRepositoryMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenId: oldRefreshJti,
        userId: mockUserId,
      }),
    );
    expect(revokedTokenSet.has(oldRefreshJti)).toBe(true);
  });

  // ─── TEST 3 — Old Refresh Token Reuse ──────────────────────────────────────
  it('TEST 3 — Reusing an old/revoked Refresh Token returns 401 Unauthorized', async () => {
    const oldRefreshJti = 'refresh-jti-rotated';
    revokedTokenSet.add(oldRefreshJti);

    const oldRefreshToken = `jwt.${process.env.REFRESH_TOKEN_SECRET || 'secret'}.${mockUserId.toString()}.${oldRefreshJti}.7d`;
    const context = createMockExecutionContext(oldRefreshToken, 'refresh');

    await expect(authGuard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token has been revoked'),
    );
  });

  // ─── TEST 4 — Logout ───────────────────────────────────────────────────────
  it('TEST 4 — Logout revokes Access Token and Refresh Token', async () => {
    const accessJti = 'access-jti-100';
    const refreshJti = 'refresh-jti-100';

    const authUser: any = {
      user: mockUser,
      token: {
        jti: accessJti,
        exp: Math.floor(Date.now() / 1000) + 900,
      },
    };

    const refreshToken = `jwt.${process.env.REFRESH_TOKEN_SECRET || 'secret'}.${mockUserId.toString()}.${refreshJti}.7d`;

    await authService.logout(authUser, refreshToken);

    expect(revokedTokenSet.has(accessJti)).toBe(true);
    expect(revokedTokenSet.has(refreshJti)).toBe(true);
    expect(userRepositoryMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          tokensRevokedAt: expect.any(Date),
        }),
      }),
    );
  });

  // ─── TEST 5 — Refresh After Logout ─────────────────────────────────────────
  it('TEST 5 — Attempting POST /auth/generate-access-token with old Refresh Token after logout fails with 401 Unauthorized', async () => {
    const accessJti = 'access-jti-logout';
    const refreshJti = 'refresh-jti-logout';

    const authUser: any = {
      user: mockUser,
      token: {
        jti: accessJti,
        exp: Math.floor(Date.now() / 1000) + 900,
      },
    };

    const refreshToken = `jwt.${process.env.REFRESH_TOKEN_SECRET || 'secret'}.${mockUserId.toString()}.${refreshJti}.7d`;

    // Perform logout
    await authService.logout(authUser, refreshToken);

    // Attempt refresh using old Refresh Token
    const context = createMockExecutionContext(refreshToken, 'refresh');

    await expect(authGuard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token has been revoked'),
    );
  });

  // ─── TEST 6 — Access Token After Logout ────────────────────────────────────
  it('TEST 6 — Attempting protected endpoint with old Access Token after logout fails with 401 Unauthorized', async () => {
    const accessJti = 'access-jti-logout-6';
    const accessToken = `jwt.${process.env.ACCESS_TOKEN_SECRET || 'secret'}.${mockUserId.toString()}.${accessJti}.15m`;

    const authUser: any = {
      user: mockUser,
      token: {
        jti: accessJti,
        exp: Math.floor(Date.now() / 1000) + 900,
      },
    };

    // Perform logout
    await authService.logout(authUser);

    // Attempt protected route using old Access Token
    const context = createMockExecutionContext(accessToken, 'access');

    await expect(authGuard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token has been revoked'),
    );
  });

  // ─── TEST 7 — Expired Refresh Token ────────────────────────────────────────
  it('TEST 7 — Attempting refresh using an expired Refresh Token returns 401 Unauthorized', async () => {
    const context = createMockExecutionContext('expired-token', 'refresh');

    await expect(authGuard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
