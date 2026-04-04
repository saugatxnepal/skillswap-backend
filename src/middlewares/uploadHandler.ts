import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { Request, Response, NextFunction } from "express";

// Allowed file extensions
const allowedExtensions = [".png", ".jpg", ".jpeg", ".pdf"];

// Create upload directory if it doesn't exist
export function ensureUploadDir(subPath: string) {
  const uploadDir = path.join(__dirname, "..", "uploads", subPath);
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  return uploadDir;
}

// Configure storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(__dirname, "..", "uploads", "profiles");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${uuidv4()}-${Date.now()}${ext}`;
    cb(null, uniqueName);
  },
});

// File filter
const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return cb(new Error(`Invalid file type. Allowed: ${allowedExtensions.join(", ")}`));
  }
  cb(null, true);
};

// Create multer instance
const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024, // 8MB
  },
  fileFilter,
});

// Simple profile upload middleware - accepts any field name and renames it
export const uploadProfileImage = (req: Request, res: Response, next: NextFunction) => {
  // First, check if there's any file in the request
  const contentType = req.headers['content-type'] || '';
  
  if (!contentType.includes('multipart/form-data')) {
    // Not a multipart request, just continue
    return next();
  }

  // Use any field name for the file
  upload.any()(req, res, (err: any) => {
    if (err) {
      console.error('Upload error:', err.message);
      return res.status(400).json({
        success: false,
        errors: [{
          field: "file",
          message: err.message || "File upload failed"
        }]
      });
    }

    // Check if any file was uploaded
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      // Take the first file regardless of field name
      const uploadedFile = req.files[0];
      
      // Attach it as req.file for compatibility with existing controllers
      req.file = uploadedFile;
      
      console.log(`File uploaded: ${uploadedFile.originalname} as ${uploadedFile.filename}`);
    }

    next();
  });
};

// Original createUploader function for backward compatibility
export function createUploader(subPath: string) {
  const uploadDir = ensureUploadDir(subPath);
  
  const customStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const uniqueName = `${uuidv4()}-${Date.now()}${ext}`;
      cb(null, uniqueName);
    },
  });

  const customUpload = multer({
    storage: customStorage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter,
  });

  return customUpload;
}

// Helper function to delete uploaded file
export function deleteUploadedFile(fileUrl: string): boolean {
  if (!fileUrl) return false;
  
  try {
    // Extract filename from URL
    const match = fileUrl.match(/\/uploads\/profiles\/(.+)$/);
    if (match && match[1]) {
      const filePath = path.join(__dirname, "..", "uploads", "profiles", match[1]);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('Deleted file:', filePath);
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('Error deleting file:', error);
    return false;
  }
}