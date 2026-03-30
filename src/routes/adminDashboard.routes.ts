// src/routes/adminDashboard.routes.ts
import { Router } from "express";
import { authenticateJWT, authorizeRoles } from "../middlewares/auth.middleware";
import {
  getDashboardStats,
  getUserGrowthChart,
  getSessionTrends,
  getTopMentors,
  getPopularSkills,
  getAllSessionsAdmin,
  getActivityLogs,
  getAdminAlerts,
} from "../controllers/adminDashboard.controller";

const router = Router();

// All admin dashboard routes require authentication and admin role
router.use(authenticateJWT);
router.use(authorizeRoles('Admin'));

// Main dashboard
router.get("/stats", getDashboardStats);
router.get("/alerts", getAdminAlerts);

// Charts and trends
router.get("/charts/user-growth", getUserGrowthChart);
router.get("/charts/session-trends", getSessionTrends);

// Lists
router.get("/top-mentors", getTopMentors);
router.get("/popular-skills", getPopularSkills);

// Data tables
router.get("/sessions", getAllSessionsAdmin);
router.get("/activity-logs", getActivityLogs);

export default router;