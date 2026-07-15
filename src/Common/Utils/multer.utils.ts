import { Request, Express } from 'express';
import { diskStorage } from 'multer';
import { extname } from 'path';

interface MulterOptions {
  allowedFileType?: string[];
}

export const uploadFileOptions = ({
  allowedFileType = ['.jpg', '.jpeg', '.png'],
}: MulterOptions) => {
  const storage = diskStorage({});

  const fileFilter = (req: Request, file: Express.Multer.File, cb: any) => {
    const fileExtension = extname(file.originalname);
    const fileMimeType = file.mimetype;

    if (allowedFileType.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  };

  return { storage, fileFilter };
};
