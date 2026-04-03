// src/routes/chat.routes.ts
import { Router } from "express";
import { authenticateJWT } from "../middlewares/auth.middleware";
import {
  getOrCreateConversation,
  getConversations,
  getMessages,
  sendMessage,
  deleteMessage,
  getUnreadCount,
  searchUsers,
} from "../controllers/chat.controller";

const router = Router();

// All chat routes require authentication
router.use(authenticateJWT);

// User search
router.get("/search", searchUsers);

// Conversations
router.get("/conversations", getConversations);
router.get("/conversations/:otherUserId", getOrCreateConversation);

// Messages
router.get("/conversations/:conversationId/messages", getMessages);
router.post("/conversations/:conversationId/messages", sendMessage);
router.delete("/messages/:messageId", deleteMessage);

// Unread count
router.get("/unread", getUnreadCount);

export default router;