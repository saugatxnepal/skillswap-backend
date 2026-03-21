import { Router } from "express";
import { authenticateJWT } from "../middlewares/auth.middleware";
import {
  getAvailableTimeSlots,
  proposeTimeSlots,
  selectTimeSlot,
  startSession,
  endSession,
} from "../controllers/session.controller";

const router = Router();

// All session routes require authentication
router.use(authenticateJWT);

// Time slot management
router.get("/:sessionId/time-slots", getAvailableTimeSlots);
router.post("/:sessionId/time-slots", proposeTimeSlots);
router.post("/:sessionId/time-slots/:timeSlotId/select", selectTimeSlot);

// Session control
router.post("/:sessionId/start", startSession);
router.post("/:sessionId/end", endSession);

export default router;