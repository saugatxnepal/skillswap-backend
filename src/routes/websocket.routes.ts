// src/routes/websocket.routes.ts
import { Router } from "express";
import { authenticateJWT } from "../middlewares/auth.middleware";
import {
  getOnlineUsersList,
  checkUserOnline,
  getUnreadMessagesCount,
  getTotalUnreadMessages,
  markAllMessagesRead,
} from "../controllers/websocket.controller";

const router = Router();

// All routes require authentication
router.use(authenticateJWT);

// Online users
router.get("/online-users", getOnlineUsersList);
router.get("/users/:userId/online", checkUserOnline);

// Unread messages
router.get("/sessions/:sessionId/unread", getUnreadMessagesCount);
router.get("/unread/total", getTotalUnreadMessages);
router.post("/sessions/:sessionId/mark-read", markAllMessagesRead);

export default router;