// src/controllers/notification.controller.ts
import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";

enum NotificationType {
  SESSION_SCHEDULED = "SESSION_SCHEDULED",
  SESSION_REMINDER = "SESSION_REMINDER",
  NEW_MESSAGE = "NEW_MESSAGE",
  MATCH_FOUND = "MATCH_FOUND",
  SESSION_CANCELLED = "SESSION_CANCELLED",
  SESSION_COMPLETED = "SESSION_COMPLETED",
  REVIEW_RECEIVED = "REVIEW_RECEIVED",
  REPORT_RESOLVED = "REPORT_RESOLVED",
  MENTOR_REQUEST = "MENTOR_REQUEST",
  LEARNER_REQUEST = "LEARNER_REQUEST",
}

// Helper functions
const getQueryNumber = (param: any, defaultValue: number): number => {
  if (!param) return defaultValue;
  const num = parseInt(param, 10);
  return isNaN(num) ? defaultValue : num;
};

// Get my notifications (paginated)
export const getMyNotifications = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const page = getQueryNumber(req.query.page, 1);
    const limit = getQueryNumber(req.query.limit, 20);
    const offset = (page - 1) * limit;
    const unreadOnly = req.query.unreadOnly === 'true';

    let queryText = `
      SELECT * FROM "Notification"
      WHERE "UserID" = $1
    `;
    const params: any[] = [userId];
    let paramCount = 1;

    if (unreadOnly) {
      paramCount++;
      queryText += ` AND "IsRead" = false`;
    }

    queryText += ` ORDER BY "CreatedAt" DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM "Notification" WHERE "UserID" = $1`;
    if (unreadOnly) {
      countQuery += ` AND "IsRead" = false`;
    }
    const countResult = await query(countQuery, [userId]);
    const total = parseInt(countResult.rows[0].count);

    return res.status(200).json({
      success: true,
      data: {
        notifications: result.rows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
        unreadCount: unreadOnly ? total : null,
      },
    });
  } catch (error) {
    console.error("[Notification] Get my notifications error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch notifications")],
    });
  }
});

// Get unread notification count
export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;

    const result = await query(
      `SELECT COUNT(*) as unread_count
       FROM "Notification"
       WHERE "UserID" = $1 AND "IsRead" = false`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      data: { unreadCount: parseInt(result.rows[0].unread_count) },
    });
  } catch (error) {
    console.error("[Notification] Get unread count error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to get unread count")],
    });
  }
});

// Mark single notification as read
export const markNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { notificationId } = req.params;

    const result = await query(
      `UPDATE "Notification" 
       SET "IsRead" = true, "ReadAt" = NOW()
       WHERE "NotificationID" = $1 AND "UserID" = $2
       RETURNING *`,
      [notificationId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("notification", "Notification not found")],
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
      message: "Notification marked as read",
    });
  } catch (error) {
    console.error("[Notification] Mark read error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to mark notification as read")],
    });
  }
});

// Mark all notifications as read
export const markAllNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;

    const result = await query(
      `UPDATE "Notification" 
       SET "IsRead" = true, "ReadAt" = NOW()
       WHERE "UserID" = $1 AND "IsRead" = false
       RETURNING *`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      data: {
        updatedCount: result.rows.length,
      },
      message: `${result.rows.length} notifications marked as read`,
    });
  } catch (error) {
    console.error("[Notification] Mark all read error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to mark all notifications as read")],
    });
  }
});

// Delete notification
export const deleteNotification = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { notificationId } = req.params;

    const result = await query(
      `DELETE FROM "Notification" 
       WHERE "NotificationID" = $1 AND "UserID" = $2
       RETURNING *`,
      [notificationId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("notification", "Notification not found")],
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
    });
  } catch (error) {
    console.error("[Notification] Delete error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to delete notification")],
    });
  }
});

// Delete all read notifications
export const deleteAllReadNotifications = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;

    const result = await query(
      `DELETE FROM "Notification" 
       WHERE "UserID" = $1 AND "IsRead" = true
       RETURNING *`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      data: {
        deletedCount: result.rows.length,
      },
      message: `${result.rows.length} read notifications deleted`,
    });
  } catch (error) {
    console.error("[Notification] Delete all read error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to delete read notifications")],
    });
  }
});

// Get notification settings (from user preferences)
export const getNotificationSettings = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;

    const result = await query(
      `SELECT "NotificationPreferences" FROM "User" WHERE "UserID" = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("user", "User not found")],
      });
    }

    const preferences = result.rows[0].NotificationPreferences || {
      email: true,
      inApp: true,
      types: {
        sessionScheduled: true,
        sessionReminder: true,
        newMessage: true,
        matchFound: true,
        sessionCancelled: true,
        sessionCompleted: true,
        reviewReceived: true,
        reportResolved: true,
      },
    };

    return res.status(200).json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    console.error("[Notification] Get settings error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch notification settings")],
    });
  }
});

// Update notification settings
export const updateNotificationSettings = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { email, inApp, types } = req.body;

    // Get current preferences
    const currentResult = await query(
      `SELECT "NotificationPreferences" FROM "User" WHERE "UserID" = $1`,
      [userId]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("user", "User not found")],
      });
    }

    const currentPrefs = currentResult.rows[0].NotificationPreferences || {
      email: true,
      inApp: true,
      types: {},
    };

    // Merge updates
    const updatedPrefs = {
      email: email !== undefined ? email : currentPrefs.email,
      inApp: inApp !== undefined ? inApp : currentPrefs.inApp,
      types: {
        ...currentPrefs.types,
        ...types,
      },
    };

    await query(
      `UPDATE "User" 
       SET "NotificationPreferences" = $1, "UpdatedAt" = NOW()
       WHERE "UserID" = $2`,
      [updatedPrefs, userId]
    );

    return res.status(200).json({
      success: true,
      data: updatedPrefs,
      message: "Notification settings updated",
    });
  } catch (error) {
    console.error("[Notification] Update settings error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to update notification settings")],
    });
  }
});

// Admin: Send notification to all users
export const sendBroadcastNotification = asyncHandler(async (req: Request, res: Response) => {
  try {
    const currentUserRole = (req as any).user?.role;
    const { title, content, type, userRole } = req.body;

    // Check if user is admin
    if (currentUserRole !== 'Admin') {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only admin can send broadcast notifications")],
      });
    }

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        errors: [formatError("fields", "Title and content are required")],
      });
    }

    // Build query to get target users
    let userQuery = `SELECT "UserID" FROM "User" WHERE "Status" = 'Active'`;
    const params: any[] = [];

    if (userRole && ['Admin', 'Mentor', 'Learner'].includes(userRole)) {
      userQuery += ` AND "Role" = $1`;
      params.push(userRole);
    }

    const users = await query(userQuery, params);

    // Insert notifications for all target users
    let insertedCount = 0;
    for (const user of users.rows) {
      await query(
        `INSERT INTO "Notification" 
         ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
        [user.UserID, type || 'SYSTEM', title, content, JSON.stringify({ broadcast: true })]
      );
      insertedCount++;
    }

    return res.status(201).json({
      success: true,
      data: {
        recipientsCount: insertedCount,
      },
      message: `Broadcast notification sent to ${insertedCount} users`,
    });
  } catch (error) {
    console.error("[Notification] Broadcast error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to send broadcast notification")],
    });
  }
});