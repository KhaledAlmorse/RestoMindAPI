import { Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import {
  RevokedToken,
  type RevokeTokenDocument,
} from '../Models/revoked-token.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class RevokeTokenRepository extends BaseService<RevokeTokenDocument> {
  constructor(
    @InjectModel(RevokedToken.name)
    private readonly revokedTokenModel: Model<RevokeTokenDocument>,
  ) {
    super(revokedTokenModel);
  }
}
