// src/routes/auth.routes.ts
import { Router } from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  logoutAllDevices,
  getProfile,
  getUserSessions,
  verifyEmail,
  checkEmailAvailability,
  getUserActivity,
  forgotPassword,
  resetPassword,
  validateResetToken,
} from "../controllers/auth.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";

const router = Router();

// Public routes
router.post("/register", registerUser);
router.post("/login", loginUser);

// Password reset routes
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);
router.get("/validate-reset-token/:token", validateResetToken);

router.get("/verify-email/:token", verifyEmail);
router.get("/check-email/:email", checkEmailAvailability);

// Protected routes
router.use(authenticateJWT);

router.post("/logout", logoutUser);
router.post("/logout-all", logoutAllDevices);

router.get("/profile", getProfile);
router.get("/sessions", getUserSessions);
router.get("/activity", getUserActivity);

export default router;