import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Auth, AuthUser } from 'src/Common/Decorators';
import type { IAuthUser } from 'src/Common/Types';
import { CreateImportDto } from './dto/create-import.dto';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import { QueryImportDto } from './dto/query-import.dto';
import { ImportsService } from './imports.service';

@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post()
  @Auth('manager', 'admin')
  @UseInterceptors(FileInterceptor('file'))
  async createImport(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateImportDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.importsService.createImport(
      file,
      dto,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.CREATED).json(result);
  }

  @Post(':id/preview')
  @Auth('manager', 'admin')
  async previewImport(
    @Param('id') id: string,
    @Body() dto: ConfirmImportDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.importsService.previewImport(
      id,
      dto.columnMapping,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Post(':id/confirm')
  @Auth('manager', 'admin')
  async confirmImport(
    @Param('id') id: string,
    @Body() dto: ConfirmImportDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.importsService.confirmImport(
      id,
      dto,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get()
  @Auth('manager', 'admin')
  async getImportJobs(
    @Query() query: QueryImportDto,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.importsService.getImportJobs(
      query,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Get(':id')
  @Auth('manager', 'admin')
  async getImportJobById(
    @Param('id') id: string,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.importsService.getImportJobById(
      id,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Post(':id/retry-ai-ingest')
  @Auth('manager', 'admin')
  async retryAiIngest(
    @Param('id') id: string,
    @AuthUser() authUser: IAuthUser,
    @Res() res: Response,
  ) {
    const result = await this.importsService.retryAiIngest(
      id,
      authUser.user._id.toString(),
    );
    res.status(HttpStatus.OK).json(result);
  }
}
