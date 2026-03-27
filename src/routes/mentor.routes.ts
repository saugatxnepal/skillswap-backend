import { Router } from "express";
import { authenticateJWT, authorizeRoles } from "../middlewares/auth.middleware";
import {
  // Skill categories
  getSkillCategories,
  // Skill management
  addMentorSkill,
  getMyMentorSkills,
  updateMentorSkill,
  toggleSkillAvailability,
  deleteMentorSkill,
  // Availability management
  setWeeklyAvailability,
  getMentorAvailability,
  getMyAvailability,
  addSpecificAvailability,
  removeAvailability,
  // Session management
  getMentorSessions,
  getSessionDetails,
  updateSessionStatus,
} from "../controllers/mentor.controller";
import { Role } from "../constants/roles";

const router = Router();

// ==================== PUBLIC ROUTES (No Auth) ====================
// Get mentor availability (public)
router.get(
  "/availability/:mentorId",
  getMentorAvailability
);

// ==================== PROTECTED ROUTES ====================
router.use(authenticateJWT);

// Skill categories
router.get(
  "/categories",
  getSkillCategories
);

// My skills
router.get(
  "/skills",
  getMyMentorSkills
);

// Add new skill
router.post("/skills", addMentorSkill);

// Update skill
router.put("/skills/:skillId", updateMentorSkill);

// Toggle skill availability
router.patch("/skills/:skillId/toggle", toggleSkillAvailability);

// Delete skill
router.delete("/skills/:skillId", deleteMentorSkill);

// ==================== AVAILABILITY MANAGEMENT ====================
// Set weekly availability
router.post("/availability/weekly", setWeeklyAvailability);

// Get my availability
router.get(
  "/availability",
  getMyAvailability
);

// Add specific date availability
router.post("/availability/specific", addSpecificAvailability);

// Remove availability slot
router.delete("/availability/:availabilityId", removeAvailability);

// ==================== SESSION MANAGEMENT ====================
// Get my sessions
router.get(
  "/sessions",
  getMentorSessions
);

// Get session details
router.get(
  "/sessions/:sessionId",
  getSessionDetails
);

// Update session status
router.patch("/sessions/:sessionId/status", updateSessionStatus);

export default router;