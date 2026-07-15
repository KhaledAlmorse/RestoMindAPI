import { Injectable } from '@nestjs/common';
import { JwtService, JwtSignOptions, JwtVerifyOptions } from '@nestjs/jwt';

@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  generate(payload: object, options?: JwtSignOptions): string {
    return this.jwtService.sign(payload, options);
  }

  verify(token: string, options?: JwtVerifyOptions) {
    return this.jwtService.verify(token, options);
  }
}
