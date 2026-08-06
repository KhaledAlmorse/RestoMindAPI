import { BadRequestException } from '@nestjs/common';
import { Request, Express } from 'express';
import { diskStorage } from 'multer';
import { extname } from 'path';

interface MulterOptions {
  allowedFileType?: string[];
}

const FORBIDDEN_EXTENSIONS = ['.exe', '.sh', '.php', '.js', '.bat', '.cmd', '.py', '.rb', '.pl', '.jar', '.dll'];

export const uploadFileOptions = ({
  allowedFileType = ['.jpg', '.jpeg', '.png', '.webp'],
}: MulterOptions = {}) => {
  const storage = diskStorage({});

  const maxFileSizeMB = process.env.MAX_UPLOAD_SIZE
    ? parseInt(process.env.MAX_UPLOAD_SIZE, 10)
    : 5;
  const limits = {
    fileSize: maxFileSizeMB * 1024 * 1024,
  };

  const fileFilter = (req: Request, file: Express.Multer.File, cb: any) => {
    const fileExtension = extname(file.originalname).toLowerCase();

    if (FORBIDDEN_EXTENSIONS.includes(fileExtension)) {
      return cb(
        new BadRequestException(
          `Security violation: Uploading executable or script files (${fileExtension}) is prohibited.`,
        ),
        false,
      );
    }

    const cleanTypes = allowedFileType.map((ext) => ext.replace(/^\./, ''));

    if (allowedFileType.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException(
          `Unsupported file type. Supported types are: ${cleanTypes.join(', ')}.`,
        ),
        false,
      );
    }
  };

  return { storage, fileFilter, limits };
};

