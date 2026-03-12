import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { Request } from "express";

// Allowed file extensions
const allowedExtensions = [".png", ".jpg", ".jpeg", ".pdf"];

// Create a multer uploader for a specific subdirectory
export function createUploader(subPath: string) {
  const uploadDir = path.join(__dirname, "..", "uploads", subPath);

  // Ensure target folder exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // Configure storage destination and file naming
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const uniqueName = `${uuidv4()}-${Date.now()}${ext}`;
      cb(null, uniqueName);
    },
  });

  // Validate file type
  function fileFilter(
    _req: Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
  ) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(ext))
      return cb(new Error(`Invalid file type`));
    cb(null, true);
  }

  return multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter,
  });
}
