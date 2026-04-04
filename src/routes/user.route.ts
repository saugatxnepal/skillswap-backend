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

import { flexibleUpload, singleFileUpload } from "../middlewares/uploadHandler";
import { Role } from "../constants/roles";
import { authenticateJWT, authorizeRoles } from "../middlewares/auth.middleware";

const router = Router();

// ==================== USER ROUTES (AUTH REQUIRED) ====================

// GET /users/me
router.get(
  "/me",
  authenticateJWT,
  getCurrentUserProfile
);

// UPDATE PROFILE - Using flexible upload that accepts multiple field names
router.put(
  "/me",
  authenticateJWT,
  flexibleUpload("profiles", ["profileImage", "image", "photo", "avatar", "file"]),
  updateCurrentUserProfile
);

router.patch(
  "/me",
  authenticateJWT,
  flexibleUpload("profiles", ["profileImage", "image", "photo", "avatar", "file"]),
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

// UPDATE USER BY ID - Using flexible upload
router.put(
  "/:id",
  authenticateJWT,
  authorizeRoles(Role.Admin),
  flexibleUpload("profiles", ["profileImage", "image", "photo", "avatar", "file"]),
  updateUserProfileById
);

router.patch(
  "/:id",
  authenticateJWT,
  authorizeRoles(Role.Admin),
  flexibleUpload("profiles", ["profileImage", "image", "photo", "avatar", "file"]),
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