// src/routes/report.routes.ts
import { Router } from "express";
import { authenticateJWT, authorizeRoles } from "../middlewares/auth.middleware";
import { createUploader } from "../middlewares/uploadHandler";
import {
  submitReport,
  getMyReports,
  getReportsAgainstMe,
  getAllReports,
  getReportById,
  resolveReport,
  getReportStats,
} from "../controllers/report.controller";

const router = Router();
const evidenceUpload = createUploader('reports');

// ==================== PROTECTED ROUTES ====================
router.use(authenticateJWT);

// Submit a report (with evidence upload)
router.post(
  "/sessions/:sessionId/reports",
  evidenceUpload.array('evidence', 5),
  submitReport
);

// Submit a report without session (general report)
router.post(
  "/users/:reportedUserId/reports",
  evidenceUpload.array('evidence', 5),
  submitReport
);

// Get my reports (as reporter)
router.get("/my-reports", getMyReports);

// Get reports against me (as reported user)
router.get("/reports-against-me", getReportsAgainstMe);

// ==================== ADMIN ROUTES ====================
// Get all reports (admin only)
router.get(
  "/admin/all",
  authorizeRoles('Admin'),
  getAllReports
);

// Get report statistics (admin only)
router.get(
  "/admin/stats",
  authorizeRoles('Admin'),
  getReportStats
);

// Get report by ID (admin only)
router.get(
  "/admin/:reportId",
  authorizeRoles('Admin'),
  getReportById
);

// Resolve report (admin only)
router.patch(
  "/admin/:reportId/resolve",
  authorizeRoles('Admin'),
  resolveReport
);

export default router;