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
import { authenticateJWT, authorizeRoles } from "../middlewares/auth.middleware";

const router = Router();

// Create uploader for profile images
const profileUpload = createUploader("profiles");


// ==================== USER ROUTES (AUTH REQUIRED) ====================

// GET /users/me
router.get(
  "/me",
  authenticateJWT,
  getCurrentUserProfile
);

// UPDATE PROFILE
router.put(
  "/me",
  authenticateJWT,
  profileUpload.single("profileImage"),
  updateCurrentUserProfile
);

router.patch(
  "/me",
  authenticateJWT,
  profileUpload.single("profileImage"),
  updateCurrentUserProfile
);

// PASSWORD UPDATE
router.put(
  "/me/password",
  authenticateJWT,
  updateUserPassword
);

router.patch(
  "/me/password",
  authenticateJWT,
  updateUserPassword
);

// NOTIFICATION SETTINGS
router.put(
  "/me/notifications",
  authenticateJWT,
  updateNotificationPreferences
);

router.patch(
  "/me/notifications",
  authenticateJWT,
  updateNotificationPreferences
);


// ==================== ADMIN ROUTES ====================

// GET ALL USERS
router.get(
  "/",
  authenticateJWT,
  authorizeRoles(Role.Admin),
  getAllUsers
);

// GET USER STATS
router.get(
  "/stats",
  authenticateJWT,
  authorizeRoles(Role.Admin),
  getUserStats
);

// GET USER BY ID (ADMIN or SELF handled in controller)
router.get(
  "/:id",
  authenticateJWT,
  getUserById
);

// UPDATE USER BY ID
router.put(
  "/:id",
  authenticateJWT,
  authorizeRoles(Role.Admin),
  profileUpload.single("profileImage"),
  updateUserProfileById
);

router.patch(
  "/:id",
  authenticateJWT,
  authorizeRoles(Role.Admin),
  profileUpload.single("profileImage"),
  updateUserProfileById
);

// UPDATE ROLE
router.patch(
  "/:id/role",
  authenticateJWT,
  authorizeRoles(Role.Admin),
  updateUserRole
);

// UPDATE STATUS
router.patch(
  "/:id/status",
  authenticateJWT,
  authorizeRoles(Role.Admin),
  updateUserStatus
);

// DELETE USER
router.delete(
  "/:id",
  authenticateJWT,
  authorizeRoles(Role.Admin),
  deleteUser
);

export default router;