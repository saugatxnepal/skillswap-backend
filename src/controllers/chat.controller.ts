// src/controllers/chat.controller.ts
import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";

// Helper functions
const getQueryNumber = (param: any, defaultValue: number): number => {
  if (!param) return defaultValue;
  const num = parseInt(param, 10);
  return isNaN(num) ? defaultValue : num;
};

// Get messages for a session (chat history)
export const getMessages = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;
    const limit = getQueryNumber(req.query.limit, 50);
    const before = req.query.before as string;

    // Check if user is part of the session
    const sessionCheck = await query(
      `SELECT * FROM "Session" 
       WHERE "SessionID" = $1 AND ("MentorID" = $2 OR "LearnerID" = $2)`,
      [sessionId, userId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "You are not part of this session")],
      });
    }

    let queryText = `
      SELECT m.*, 
             u."FullName" as "SenderName", 
             u."ProfileImageURL" as "SenderImage"
      FROM "Message" m
      JOIN "User" u ON m."SenderID" = u."UserID"
      WHERE m."SessionID" = $1
    `;
    const params: any[] = [sessionId];
    let paramCount = 1;

    if (before) {
      paramCount++;
      queryText += ` AND m."CreatedAt" < $${paramCount}`;
      params.push(before);
    }

    queryText += ` ORDER BY m."CreatedAt" DESC LIMIT $${paramCount + 1}`;
    params.push(limit);

    const result = await query(queryText, params);
    
    // Reverse to show oldest first
    const messages = result.rows.reverse();

    // Mark messages as read (for messages sent by other user)
    await query(
      `UPDATE "Message" 
       SET "ReadAt" = NOW()
       WHERE "SessionID" = $1 AND "SenderID" != $2 AND "ReadAt" IS NULL`,
      [sessionId, userId]
    );

    return res.status(200).json({
      success: true,
      data: messages,
    });
  } catch (error) {
    console.error("[Chat] Get messages error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch messages")],
    });
  }
});

// Send a message (REST fallback, but WebSocket is preferred)
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;
    const { content, messageType = 'TEXT', replyToId } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        errors: [formatError("content", "Message content is required")],
      });
    }

    // Check if user is part of the session
    const sessionCheck = await query(
      `SELECT * FROM "Session" 
       WHERE "SessionID" = $1 AND ("MentorID" = $2 OR "LearnerID" = $2)`,
      [sessionId, userId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "You are not part of this session")],
      });
    }

    const session = sessionCheck.rows[0];

    // Insert message
    const result = await query(
      `INSERT INTO "Message" 
       ("MessageID", "SessionID", "SenderID", "Content", "MessageType", "ReplyToID", "CreatedAt", "UpdatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING *`,
      [sessionId, userId, content.trim(), messageType, replyToId || null]
    );

    const message = result.rows[0];

    // Get sender info
    const senderInfo = await query(
      `SELECT "FullName", "ProfileImageURL" FROM "User" WHERE "UserID" = $1`,
      [userId]
    );

    // Create notification for the other participant
    const otherUserId = session.MentorID === userId ? session.LearnerID : session.MentorID;
    
    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
       VALUES (gen_random_uuid(), $1, 'NEW_MESSAGE', $2, $3, $4, NOW())`,
      [otherUserId, "New Message", 
       `${senderInfo.rows[0].FullName} sent a message: ${content.substring(0, 50)}...`,
       JSON.stringify({ sessionId, messageId: message.MessageID })]
    );

    return res.status(201).json({
      success: true,
      data: {
        ...message,
        senderName: senderInfo.rows[0].FullName,
        senderImage: senderInfo.rows[0].ProfileImageURL,
      },
    });
  } catch (error) {
    console.error("[Chat] Send message error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to send message")],
    });
  }
});

// Edit a message
export const editMessage = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { messageId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        errors: [formatError("content", "Message content is required")],
      });
    }

    const result = await query(
      `UPDATE "Message" 
       SET "Content" = $1, "IsEdited" = true, "EditedAt" = NOW(), "UpdatedAt" = NOW()
       WHERE "MessageID" = $2 AND "SenderID" = $3
       RETURNING *`,
      [content.trim(), messageId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("message", "Message not found or you can't edit it")],
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
      message: "Message edited successfully",
    });
  } catch (error) {
    console.error("[Chat] Edit message error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to edit message")],
    });
  }
});

// Delete a message
export const deleteMessage = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { messageId } = req.params;

    const result = await query(
      `DELETE FROM "Message" 
       WHERE "MessageID" = $1 AND "SenderID" = $2
       RETURNING "SessionID"`,
      [messageId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("message", "Message not found or you can't delete it")],
      });
    }

    return res.status(200).json({
      success: true,
      message: "Message deleted successfully",
    });
  } catch (error) {
    console.error("[Chat] Delete message error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to delete message")],
    });
  }
});

// Mark a message as read
export const markMessageRead = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { messageId } = req.params;

    const result = await query(
      `UPDATE "Message" 
       SET "ReadAt" = NOW()
       WHERE "MessageID" = $1 AND "SenderID" != $2 AND "ReadAt" IS NULL
       RETURNING *`,
      [messageId, userId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows[0],
      message: "Message marked as read",
    });
  } catch (error) {
    console.error("[Chat] Mark message read error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to mark message as read")],
    });
  }
});

// Mark all messages in a session as read
export const markAllMessagesRead = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;

    const result = await query(
      `UPDATE "Message" 
       SET "ReadAt" = NOW()
       WHERE "SessionID" = $1 AND "SenderID" != $2 AND "ReadAt" IS NULL
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
    console.error("[Chat] Mark all messages read error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to mark messages as read")],
    });
  }
});

// Get unread message count for a session
export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
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
    console.error("[Chat] Get unread count error:", error);
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
    console.error("[Chat] Get total unread error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to get total unread count")],
    });
  }
});