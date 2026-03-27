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
  getUserActivity
} from "../controllers/auth.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";

const router = Router();

// Public routes
router.post("/register", registerUser);
router.post("/login", loginUser);

router.get(
  "/verify-email/:token",
  verifyEmail
);

router.get(
  "/check-email/:email",
  checkEmailAvailability
);

// Protected routes
router.use(authenticateJWT);

router.post("/logout", logoutUser);
router.post("/logout-all", logoutAllDevices);

router.get(
  "/profile",
  getProfile
);

router.get(
  "/sessions",
  getUserSessions
);

router.get(
  "/activity",
  getUserActivity
);

export default router;