import { Injectable } from '@nestjs/common';
import cloudinary from '../Config/cloudinary.config';
import { UploadApiOptions } from 'cloudinary';

@Injectable()
export class UploadCloudFileService {
  private cloudnairy = cloudinary;
  constructor() {}

  async uploadFile(file: string, options: UploadApiOptions) {
    const data = await this.cloudnairy.uploader.upload(file, options);
    return { secure_url: data.secure_url, public_id: data.public_id };
  }

  async UploadFiles(files: string[], options: UploadApiOptions) {
    const images: { secure_url: string; public_id: string }[] = [];
    for (const path of files) {
      const data = await this.uploadFile(path, options);
      images.push(data);
    }
    return images;
  }

  async DeleteFileByPublicId(publicId: string) {
    await this.cloudnairy.uploader.destroy(publicId);
    return { success: true };
  }

  async DeleteFolderByPrefix(prefix: string) {
    await this.cloudnairy.api.delete_resources_by_prefix(prefix);
    await this.cloudnairy.api.delete_folder(prefix);
    return { success: true };
  }
}
