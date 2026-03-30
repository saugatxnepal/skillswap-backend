// src/routes/notification.routes.ts
import { Router } from "express";
import { authenticateJWT, authorizeRoles } from "../middlewares/auth.middleware";
import {
  getMyNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  deleteAllReadNotifications,
  getNotificationSettings,
  updateNotificationSettings,
  sendBroadcastNotification,
} from "../controllers/notification.controller";

const router = Router();

// All notification routes require authentication
router.use(authenticateJWT);

// ==================== USER NOTIFICATION ROUTES ====================
// Get my notifications
router.get("/", getMyNotifications);

// Get unread count
router.get("/unread-count", getUnreadCount);

// Mark notification as read
router.patch("/:notificationId/read", markNotificationRead);

// Mark all as read
router.patch("/read-all", markAllNotificationsRead);

// Delete notification
router.delete("/:notificationId", deleteNotification);

// Delete all read notifications
router.delete("/read/all", deleteAllReadNotifications);

// ==================== NOTIFICATION SETTINGS ====================
// Get notification settings
router.get("/settings", getNotificationSettings);

// Update notification settings
router.put("/settings", updateNotificationSettings);
router.patch("/settings", updateNotificationSettings);

// ==================== ADMIN ROUTES ====================
// Send broadcast notification (admin only)
router.post(
  "/broadcast",
  authorizeRoles('Admin'),
  sendBroadcastNotification
);

export default router;