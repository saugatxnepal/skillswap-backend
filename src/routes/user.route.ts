import { Router } from "express";
import {
  // Public/Protected routes (use JWT)
  getCurrentUserProfile,
  updateCurrentUserProfile,
  updateUserPassword,
  
  // Admin routes
  getAllUsers,
  getUserById,
  updateUserProfileById,
  updateUserRole,
  updateUserStatus,
  deleteUser,
  getUserStats,
} from "../controllers/user.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";
import { cacheMiddleware } from "../middlewares/cache.middleware";
import { createUploader } from "../middlewares/uploadHandler";

const router = Router();

// Create uploader for profile images
const profileUpload = createUploader('profiles');

// All user routes require authentication
router.use(authenticateJWT);

// ==================== USER ROUTES (no ID needed, uses JWT token) ====================
// GET /users/me - Get current user profile
router.get(
  "/me", 
  cacheMiddleware({ ttl: 300, keyPrefix: 'user-me' }),
  getCurrentUserProfile
);

// PUT/PATCH /users/me - Update current user profile (with file upload)
router.put("/me", profileUpload.single('profileImage'), updateCurrentUserProfile);
router.patch("/me", profileUpload.single('profileImage'), updateCurrentUserProfile);

// Password update
router.put("/me/password", updateUserPassword);
router.patch("/me/password", updateUserPassword);

// ==================== ADMIN ROUTES (require admin role) ====================
// GET requests with cache
router.get(
  "/", 
  cacheMiddleware({ ttl: 300, keyPrefix: 'users' }), 
  getAllUsers
);

router.get(
  "/stats", 
  cacheMiddleware({ ttl: 3600, keyPrefix: 'user-stats' }), 
  getUserStats
);

router.get(
  "/:id", 
  cacheMiddleware({ ttl: 3600, keyPrefix: 'user' }), 
  getUserById
);

// Admin update routes (with file upload support)
router.put("/:id", profileUpload.single('profileImage'), updateUserProfileById);
router.patch("/:id", profileUpload.single('profileImage'), updateUserProfileById);
router.patch("/:id/role", updateUserRole);
router.patch("/:id/status", updateUserStatus);
router.delete("/:id", deleteUser);

export default router;