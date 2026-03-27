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
import { createUploader } from "../middlewares/uploadHandler";
import { Role } from "../constants/roles";
import { authorizeRoles } from "../middlewares/auth.middleware";

const router = Router();

// Create uploader for profile images
const profileUpload = createUploader('profiles');


// ==================== USER ROUTES (no ID needed, uses JWT token) ====================
// GET /users/me - Get current user profile
router.get(
  "/me",
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
  getAllUsers
);

router.get(
  "/stats",
  authorizeRoles(Role.Admin), // Pass the string "Admin"
  getUserStats
);

router.get(
  "/:id",
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