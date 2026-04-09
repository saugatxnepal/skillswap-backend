// src/routes/session.routes.ts
import { Router } from "express";
import { authenticateJWT } from "../middlewares/auth.middleware";
import {
  getAvailableTimeSlots,
  proposeTimeSlots,
  selectTimeSlot,
  startSession,
  endSession,
  getSessionMeetingInfo,
  generateSessionJoinLink,
  getSessionJoinInfo,
} from "../controllers/session.controller";

const router = Router();

router.use(authenticateJWT);

router.get("/:sessionId/time-slots", getAvailableTimeSlots);
router.post("/:sessionId/time-slots", proposeTimeSlots);
router.post("/:sessionId/time-slots/:timeSlotId/select", selectTimeSlot);
router.post("/:sessionId/start", startSession);
router.post("/:sessionId/end", endSession);
router.get("/:sessionId/meeting-info", getSessionMeetingInfo);

router.get("/:sessionId/join-link", authenticateJWT, generateSessionJoinLink);
router.get("/join/:token", joinViaLink); // Public endpoint
router.get("/:sessionId/join-info", authenticateJWT, getSessionJoinInfo);

export default router;