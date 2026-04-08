// src/routes/webrtc.routes.ts
import { Router } from "express";
import { authenticateJWT } from "../middlewares/auth.middleware";
import { getSessionMeetingInfo } from "../controllers/session.controller";

const router = Router();

router.use(authenticateJWT);

// Get meeting info for WebRTC session
router.get("/session/:sessionId", getSessionMeetingInfo);

export default router;