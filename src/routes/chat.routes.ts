// src/routes/chat.routes.ts
import { Router } from "express";
import { authenticateJWT } from "../middlewares/auth.middleware";
import {
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  markMessageRead,
  markAllMessagesRead,
  getUnreadCount,
  getTotalUnreadMessages,
} from "../controllers/chat.controller";

const router = Router();

// All chat routes require authentication
router.use(authenticateJWT);

// Messages
router.get("/sessions/:sessionId/messages", getMessages);
router.post("/sessions/:sessionId/messages", sendMessage);

// Unread counts
router.get("/sessions/:sessionId/unread", getUnreadCount);
router.get("/unread/total", getTotalUnreadMessages);

// Message actions
router.patch("/messages/:messageId", editMessage);
router.delete("/messages/:messageId", deleteMessage);
router.patch("/messages/:messageId/read", markMessageRead);
router.post("/sessions/:sessionId/mark-read", markAllMessagesRead);

export default router;