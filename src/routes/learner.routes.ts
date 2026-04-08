// src/routes/learner.routes.ts
import { Router } from "express";
import { authenticateJWT } from "../middlewares/auth.middleware";
import {
  // Skill management
  addLearnerSkill,
  getMyLearningSkills,
  removeLearnerSkill,
  // Matching
  getMatchedMentors,
  getMatchedMentorDetails,
  // Recommendations
  getRecommendedSkills,
  // Session management
  requestSession,
  getMySessions,
  cancelSession,
} from "../controllers/learner.controller";

const router = Router();

// ==================== PROTECTED ROUTES (All require auth) ====================
router.use(authenticateJWT);

// ==================== LEARNER SKILL MANAGEMENT ====================
// Add skill to learn
router.post("/skills", addLearnerSkill);

// Get my learning skills
router.get("/skills", getMyLearningSkills);

// Remove learning skill
router.delete("/skills/:skillId", removeLearnerSkill);

// ==================== RECOMMENDATIONS ====================
// Get recommended skills to learn
router.get("/skills/recommended", getRecommendedSkills);

// ==================== SKILL-BASED MATCHING ====================
// Get matched mentors based on learner's skills
router.get("/mentors/matched", getMatchedMentors);

// Get matched mentor details
router.get("/mentors/:mentorId/matched", getMatchedMentorDetails);

// ==================== SESSION MANAGEMENT ====================
// Request session with matched mentor
router.post("/sessions/request", requestSession);

// Get my sessions
router.get("/sessions", getMySessions);

// Cancel session
router.patch("/sessions/:sessionId/cancel", cancelSession);

export default router;