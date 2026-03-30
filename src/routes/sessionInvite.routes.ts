// src/routes/sessionInvite.routes.ts
import { Router } from "express";
import { authenticateJWT } from "../middlewares/auth.middleware";
import {
  sendInvite,
  getSessionInvites,
  getMyInvites,
  getInvitesSent,
  acceptInvite,
  declineInvite,
  cancelInvite,
  getInviteStats,
} from "../controllers/sessionInvite.controller";

const router = Router();

// All session invite routes require authentication
router.use(authenticateJWT);

// Send an invite to a user for a session
router.post("/sessions/:sessionId/invites", sendInvite);

// Get invites for a session
router.get("/sessions/:sessionId/invites", getSessionInvites);

// Get invite statistics for a session
router.get("/sessions/:sessionId/invites/stats", getInviteStats);

// Get invites I received
router.get("/my-invites", getMyInvites);

// Get invites I sent
router.get("/invites-sent", getInvitesSent);

// Accept an invite
router.post("/invites/:inviteId/accept", acceptInvite);

// Decline an invite
router.post("/invites/:inviteId/decline", declineInvite);

// Cancel an invite (by inviter)
router.delete("/invites/:inviteId", cancelInvite);

export default router;