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

import { uploadProfileImage } from "../middlewares/uploadHandler";
import { Role } from "../constants/roles";
import { authenticateJWT, authorizeRoles } from "../middlewares/auth.middleware";

const router = Router();

// ==================== USER ROUTES (AUTH REQUIRED) ====================

// GET /users/me
router.get("/me", authenticateJWT, getCurrentUserProfile);

// UPDATE PROFILE - Using simplified upload
router.put("/me", authenticateJWT, uploadProfileImage, updateCurrentUserProfile);
router.patch("/me", authenticateJWT, uploadProfileImage, updateCurrentUserProfile);

// PASSWORD UPDATE
router.put("/me/password", authenticateJWT, updateUserPassword);
router.patch("/me/password", authenticateJWT, updateUserPassword);

// NOTIFICATION SETTINGS
router.put("/me/notifications", authenticateJWT, updateNotificationPreferences);
router.patch("/me/notifications", authenticateJWT, updateNotificationPreferences);

// ==================== ADMIN ROUTES ====================

// GET ALL USERS
router.get("/", authenticateJWT, authorizeRoles(Role.Admin), getAllUsers);

// GET USER STATS
router.get("/stats", authenticateJWT, authorizeRoles(Role.Admin), getUserStats);

// GET USER BY ID
router.get("/:id", authenticateJWT, getUserById);

// UPDATE USER BY ID
router.put("/:id", authenticateJWT, authorizeRoles(Role.Admin), uploadProfileImage, updateUserProfileById);
router.patch("/:id", authenticateJWT, authorizeRoles(Role.Admin), uploadProfileImage, updateUserProfileById);

// UPDATE ROLE
router.patch("/:id/role", authenticateJWT, authorizeRoles(Role.Admin), updateUserRole);

// UPDATE STATUS
router.patch("/:id/status", authenticateJWT, authorizeRoles(Role.Admin), updateUserStatus);

// DELETE USER
router.delete("/:id", authenticateJWT, authorizeRoles(Role.Admin), deleteUser);

export default router;