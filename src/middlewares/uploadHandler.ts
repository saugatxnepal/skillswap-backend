import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { Request, Response, NextFunction } from "express";

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
    if (!allowedExtensions.includes(ext)) {
      return cb(new Error(`Invalid file type. Allowed: ${allowedExtensions.join(", ")}`));
    }
    cb(null, true);
  }

  return multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 }, // 8MB limit
    fileFilter,
  });
}

// Flexible upload middleware that accepts multiple field names
export function flexibleUpload(subPath: string, fieldNames: string[] = ["profileImage", "image", "photo", "avatar", "file"]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const upload = createUploader(subPath);
    let currentIndex = 0;
    let fileUploaded = false;
    let uploadError: any = null;

    function tryNextField() {
      if (currentIndex >= fieldNames.length) {
        // No matching field found, continue without error if no file was expected
        if (!fileUploaded && !uploadError) {
          return next();
        }
        return next(uploadError);
      }

      const fieldName = fieldNames[currentIndex];
      const singleUpload = upload.single(fieldName);

      singleUpload(req, res, (err: any) => {
        if (err) {
          if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            // Try next field name
            currentIndex++;
            tryNextField();
          } else {
            // Other multer error
            uploadError = err;
            currentIndex++;
            tryNextField();
          }
        } else {
          // Successfully uploaded file
          fileUploaded = true;
          next();
        }
      });
    }

    tryNextField();
  };
}

// Simple single file upload with specific field name
export function singleFileUpload(subPath: string, fieldName: string = "profileImage") {
  return (req: Request, res: Response, next: NextFunction) => {
    const upload = createUploader(subPath);
    const singleUpload = upload.single(fieldName);
    
    singleUpload(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            success: false,
            errors: [{
              field: "file",
              message: `Unexpected field. Expected field name: "${fieldName}"`
            }]
          });
        }
        return next(err);
      }
      next();
    });
  };
}

// Multiple file upload (for arrays)
export function multipleFileUpload(subPath: string, fieldName: string, maxCount: number = 5) {
  return (req: Request, res: Response, next: NextFunction) => {
    const upload = createUploader(subPath);
    const arrayUpload = upload.array(fieldName, maxCount);
    
    arrayUpload(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            success: false,
            errors: [{
              field: "files",
              message: `Unexpected field. Expected field name: "${fieldName}"`
            }]
          });
        }
        return next(err);
      }
      next();
    });
  };
}

// Helper function to delete uploaded file
export function deleteUploadedFile(filePath: string): boolean {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('Deleted file:', filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deleting file:', error);
    return false;
  }
}

// Helper function to get file URL from request
export function getFileUrl(req: Request, filename: string, subPath: string): string {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/${subPath}/${filename}`;
}

// Validate file type helper
export function isValidFileType(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return allowedExtensions.includes(ext);
}

// Get file size in MB
export function getFileSizeInMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}