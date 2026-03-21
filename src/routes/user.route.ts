import { Router } from "express";
import {
  getCurrentUserProfile,
  updateCurrentUserProfile,
  updateUserPassword,
  updateNotificationPreferences,
  getAllUsers,
  getUserById,
  updateUserProfileById,
  updateUserRole,
  updateUserStatus,
  deleteUser,
  getUserStats,
} from "../controllers/user.controller";
import { authenticateJWT, authorizeRoles } from "../middlewares/auth.middleware";
import { cacheMiddleware } from "../middlewares/cache.middleware";
import { createUploader } from "../middlewares/uploadHandler";
import { Role } from "../constants/roles";

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

// Notification preferences
router.put("/me/notifications", updateNotificationPreferences);
router.patch("/me/notifications", updateNotificationPreferences);

// ==================== ADMIN ROUTES (require admin role) ====================
// GET requests with cache
router.get(
  "/", 
  authorizeRoles(Role.Admin), // Pass the string "Admin"
  cacheMiddleware({ ttl: 300, keyPrefix: 'users' }), 
  getAllUsers
);

router.get(
  "/stats", 
  authorizeRoles(Role.Admin), // Pass the string "Admin"
  cacheMiddleware({ ttl: 3600, keyPrefix: 'user-stats' }), 
  getUserStats
);

router.get(
  "/:id", 
  cacheMiddleware({ ttl: 3600, keyPrefix: 'user' }), 
  getUserById
);

// Admin update routes (with file upload support)
router.put(
  "/:id", 
  authorizeRoles(Role.Admin), // Pass the string "Admin"
  profileUpload.single('profileImage'), 
  updateUserProfileById
);
router.patch(
  "/:id", 
  authorizeRoles(Role.Admin), // Pass the string "Admin"
  profileUpload.single('profileImage'), 
  updateUserProfileById
);
router.patch(
  "/:id/role", 
  authorizeRoles(Role.Admin), // Pass the string "Admin"
  updateUserRole
);
router.patch(
  "/:id/status", 
  authorizeRoles(Role.Admin), // Pass the string "Admin"
  updateUserStatus
);
router.delete(
  "/:id", 
  authorizeRoles(Role.Admin), // Pass the string "Admin"
  deleteUser
);

export default router;