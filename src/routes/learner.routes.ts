import { Router } from "express";
import { authenticateJWT } from "../middlewares/auth.middleware";
import {
  getAllMentors,
  getMentorDetails,
  requestSession,
  getMySessions,
  cancelSession,
  getLearnerStats,
} from "../controllers/learner.controller";

const router = Router();

// Public routes (no auth needed for browsing)
router.get(
  "/mentors",
  getAllMentors
);

router.get(
  "/mentors/:mentorId",
  getMentorDetails
);

// Protected routes
router.use(authenticateJWT);

// Session management
router.post("/sessions/request", requestSession);
router.get("/sessions", getMySessions);
router.patch("/sessions/:sessionId/cancel", cancelSession);

// Learner Stats Dashboard
router.get("/stats", authenticateJWT, getLearnerStats);

export default router;