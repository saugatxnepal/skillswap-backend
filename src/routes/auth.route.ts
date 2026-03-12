// src/routes/auth.routes.ts
import { Router } from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  getProfile,
  getUserSessions,
  verifyEmail,
  checkEmailAvailability,
  getUserActivity
} from "../controllers/auth.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";
import { cacheMiddleware } from "../middlewares/cache.middleware";

const router = Router();

// ==================== PUBLIC ROUTES ====================
// POST requests - NO CACHE
router.post("/register", registerUser);
router.post("/login", loginUser);

// GET requests with cache
router.get(
  "/verify-email/:token", 
  cacheMiddleware({ ttl: 300, keyPrefix: 'verify' }), 
  verifyEmail
);

router.get(
  "/check-email/:email", 
  cacheMiddleware({ ttl: 600, keyPrefix: 'email-check' }), 
  checkEmailAvailability
);

// ==================== PROTECTED ROUTES ====================
router.use(authenticateJWT);

// POST requests - NO CACHE
router.post("/logout", logoutUser);

// GET requests with cache (all protected)
router.get(
  "/profile", 
  cacheMiddleware({ ttl: 300, keyPrefix: 'profile' }), 
  getProfile
);

router.get(
  "/sessions", 
  cacheMiddleware({ ttl: 120, keyPrefix: 'sessions' }), 
  getUserSessions
);

router.get(
  "/activity", 
  cacheMiddleware({ ttl: 300, keyPrefix: 'activity' }), 
  getUserActivity
);

export default router;