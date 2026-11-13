import { v2 as cloudinary } from "cloudinary";
import { AppError } from "../utils/errors.js";

export class StorageService {
  async upload() {
    throw new Error("upload não implementado");
  }
  async delete() {
    throw new Error("delete não implementado");
  }
}
export class CloudinaryStorageService extends StorageService {
  constructor() {
    super();
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }
  async upload(file) {
    if (!process.env.CLOUDINARY_CLOUD_NAME)
      throw new AppError(
        "Cloudinary não configurado.",
        503,
        "STORAGE_UNAVAILABLE",
      );
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "nm-calcados/products",
          resource_type: "image",
          format: "webp",
          transformation: [
            { width: 1400, height: 1400, crop: "limit", quality: "auto" },
          ],
        },
        (error, result) => {
          if (error) reject(error);
          else
            resolve({ url: result.secure_url, storageKey: result.public_id });
        },
      );
      stream.end(file.buffer);
    });
  }
  async delete(storageKey) {
    await cloudinary.uploader.destroy(storageKey, { resource_type: "image" });
  }
}
export const storage = new CloudinaryStorageService();
