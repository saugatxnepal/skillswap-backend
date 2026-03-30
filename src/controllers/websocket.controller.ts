// src/controllers/websocket.controller.ts
import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";
import { getOnlineUsers, isUserOnline } from "../socket/socket";

// Get online users list
export const getOnlineUsersList = asyncHandler(async (req: Request, res: Response) => {
  try {
    const onlineUsers = getOnlineUsers();
    
    // Get additional details for online users
    const userIds = onlineUsers.map(u => u.userId);
    
    if (userIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }
    
    const result = await query(
      `SELECT "UserID", "FullName", "Role", "ProfileImageURL"
       FROM "User" 
       WHERE "UserID" = ANY($1::uuid[])`,
      [userIds]
    );
    
    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("[WebSocket] Get online users error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to get online users")],
    });
  }
});

// Check if specific user is online
export const checkUserOnline = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const online = isUserOnline(userId);
    
    return res.status(200).json({
      success: true,
      data: {
        userId,
        isOnline: online,
      },
    });
  } catch (error) {
    console.error("[WebSocket] Check user online error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to check user status")],
    });
  }
});

// Get unread messages count for a session
export const getUnreadMessagesCount = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;
    
    const result = await query(
      `SELECT COUNT(*) as unread_count
       FROM "Message" m
       JOIN "Session" s ON m."SessionID" = s."SessionID"
       WHERE m."SessionID" = $1 
         AND m."SenderID" != $2 
         AND m."ReadAt" IS NULL
         AND (s."MentorID" = $2 OR s."LearnerID" = $2)`,
      [sessionId, userId]
    );
    
    return res.status(200).json({
      success: true,
      data: {
        unreadCount: parseInt(result.rows[0].unread_count),
      },
    });
  } catch (error) {
    console.error("[WebSocket] Get unread count error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to get unread count")],
    });
  }
});

// Get total unread messages across all sessions
export const getTotalUnreadMessages = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    
    const result = await query(
      `SELECT COUNT(*) as total_unread
       FROM "Message" m
       JOIN "Session" s ON m."SessionID" = s."SessionID"
       WHERE m."SenderID" != $1 
         AND m."ReadAt" IS NULL
         AND (s."MentorID" = $1 OR s."LearnerID" = $1)`,
      [userId]
    );
    
    return res.status(200).json({
      success: true,
      data: {
        totalUnread: parseInt(result.rows[0].total_unread),
      },
    });
  } catch (error) {
    console.error("[WebSocket] Get total unread error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to get total unread count")],
    });
  }
});

// Mark all messages as read in a session
export const markAllMessagesRead = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;
    
    const result = await query(
      `UPDATE "Message" 
       SET "ReadAt" = NOW()
       WHERE "SessionID" = $1 
         AND "SenderID" != $2 
         AND "ReadAt" IS NULL
       RETURNING "MessageID"`,
      [sessionId, userId]
    );
    
    return res.status(200).json({
      success: true,
      data: {
        updatedCount: result.rows.length,
      },
      message: `${result.rows.length} messages marked as read`,
    });
  } catch (error) {
    console.error("[WebSocket] Mark all read error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to mark messages as read")],
    });
  }
});