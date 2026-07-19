import { BadRequestException } from '@nestjs/common';
import { Request, Express } from 'express';
import { diskStorage } from 'multer';
import { extname } from 'path';

interface MulterOptions {
  allowedFileType?: string[];
}

export const uploadFileOptions = ({
  allowedFileType = ['.jpg', '.jpeg', '.png', '.webp'],
}: MulterOptions = {}) => {
  const storage = diskStorage({});

  const fileFilter = (req: Request, file: Express.Multer.File, cb: any) => {
    const fileExtension = extname(file.originalname).toLowerCase();
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

  return { storage, fileFilter };
};
