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

// Get or create a conversation between two users
export const getOrCreateConversation = asyncHandler(async (req: Request, res: Response) => {
  try {
    const currentUserId = (req as any).user?.UserID;
    const { otherUserId } = req.params;

    if (!otherUserId) {
      return res.status(400).json({
        success: false,
        errors: [formatError("otherUserId", "Other user ID is required")],
      });
    }

    // Check if other user exists
    const userCheck = await query(
      `SELECT "UserID", "FullName", "ProfileImageURL", "Role", "Status", "IsOnline"
       FROM "User" WHERE "UserID" = $1::uuid`,
      [otherUserId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("user", "User not found")],
      });
    }

    // Check if conversation exists
    let conversation = await query(
      `SELECT * FROM "Conversation" 
       WHERE ("Participant1ID" = $1::uuid AND "Participant2ID" = $2::uuid) 
          OR ("Participant1ID" = $2::uuid AND "Participant2ID" = $1::uuid)`,
      [currentUserId, otherUserId]
    );

    if (conversation.rows.length === 0) {
      // Create new conversation
      const result = await query(
        `INSERT INTO "Conversation" 
         ("ConversationID", "Participant1ID", "Participant2ID", "CreatedAt", "UpdatedAt")
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, NOW(), NOW())
         RETURNING *`,
        [currentUserId, otherUserId]
      );
      conversation = result;
    }

    return res.status(200).json({
      success: true,
      data: {
        conversation: conversation.rows[0],
        otherUser: {
          UserID: userCheck.rows[0].UserID,
          FullName: userCheck.rows[0].FullName,
          ProfileImageURL: userCheck.rows[0].ProfileImageURL,
          Role: userCheck.rows[0].Role,
          IsOnline: userCheck.rows[0].IsOnline || false,
        },
      },
    });
  } catch (error) {
    console.error("[Chat] Get conversation error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to get conversation")],
    });
  }
});

// Get all conversations for current user
export const getConversations = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const page = getQueryNumber(req.query.page, 1);
    const limit = getQueryNumber(req.query.limit, 20);
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT c.*,
              CASE 
                WHEN c."Participant1ID" = $1::uuid THEN u2."FullName" 
                ELSE u1."FullName" 
              END as "otherUserName",
              CASE 
                WHEN c."Participant1ID" = $1::uuid THEN u2."ProfileImageURL" 
                ELSE u1."ProfileImageURL" 
              END as "otherUserImage",
              CASE 
                WHEN c."Participant1ID" = $1::uuid THEN u2."UserID" 
                ELSE u1."UserID" 
              END as "otherUserId",
              CASE 
                WHEN c."Participant1ID" = $1::uuid THEN u2."IsOnline" 
                ELSE u1."IsOnline" 
              END as "otherUserOnline",
              COALESCE(c."LastMessage", '') as "lastMessage",
              c."LastMessageAt",
              COUNT(CASE WHEN m."IsRead" = false AND m."SenderID" != $1::uuid AND m."IsDeleted" = false THEN 1 END) as "unreadCount"
       FROM "Conversation" c
       JOIN "User" u1 ON c."Participant1ID" = u1."UserID"
       JOIN "User" u2 ON c."Participant2ID" = u2."UserID"
       LEFT JOIN "Message" m ON c."ConversationID" = m."ConversationID"
       WHERE c."Participant1ID" = $1::uuid OR c."Participant2ID" = $1::uuid
       GROUP BY c."ConversationID", u1."UserID", u2."UserID", u1."FullName", u2."FullName",
                u1."ProfileImageURL", u2."ProfileImageURL", u1."IsOnline", u2."IsOnline"
       ORDER BY c."LastMessageAt" DESC NULLS LAST
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM "Conversation" 
       WHERE "Participant1ID" = $1::uuid OR "Participant2ID" = $1::uuid`,
      [userId]
    );
    const total = parseInt(countResult.rows[0].count);

    return res.status(200).json({
      success: true,
      data: {
        conversations: result.rows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("[Chat] Get conversations error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to get conversations")],
    });
  }
});

// Get messages for a conversation
export const getMessages = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { conversationId } = req.params;
    const limit = getQueryNumber(req.query.limit, 50);
    const before = req.query.before as string;

    // Check if user is part of conversation
    const convCheck = await query(
      `SELECT * FROM "Conversation" 
       WHERE "ConversationID" = $1::uuid AND ("Participant1ID" = $2::uuid OR "Participant2ID" = $2::uuid)`,
      [conversationId, userId]
    );

    if (convCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "You are not part of this conversation")],
      });
    }

    let queryText = `
      SELECT m.*, u."FullName" as "SenderName", u."ProfileImageURL" as "SenderImage"
      FROM "Message" m
      JOIN "User" u ON m."SenderID" = u."UserID"
      WHERE m."ConversationID" = $1::uuid AND m."IsDeleted" = false
    `;
    const params: any[] = [conversationId];
    let paramCount = 1;

    if (before) {
      paramCount++;
      queryText += ` AND m."CreatedAt" < $${paramCount}::timestamptz`;
      params.push(before);
    }

    queryText += ` ORDER BY m."CreatedAt" DESC LIMIT $${paramCount + 1}`;
    params.push(limit);

    const result = await query(queryText, params);
    const messages = result.rows.reverse();

    // Mark messages as read
    await query(
      `UPDATE "Message" 
       SET "IsRead" = true, "ReadAt" = NOW()
       WHERE "ConversationID" = $1::uuid AND "SenderID" != $2::uuid AND "IsRead" = false`,
      [conversationId, userId]
    );

    return res.status(200).json({
      success: true,
      data: messages,
    });
  } catch (error) {
    console.error("[Chat] Get messages error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to get messages")],
    });
  }
});

// Send a message (REST fallback)
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { conversationId } = req.params;
    const { content, messageType = 'TEXT', replyToId } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        errors: [formatError("content", "Message content is required")],
      });
    }

    // Check if user is part of conversation
    const convCheck = await query(
      `SELECT c.*, 
              CASE WHEN c."Participant1ID" = $2::uuid THEN c."Participant2ID" ELSE c."Participant1ID" END as "ReceiverID"
       FROM "Conversation" c
       WHERE c."ConversationID" = $1::uuid AND (c."Participant1ID" = $2::uuid OR c."Participant2ID" = $2::uuid)`,
      [conversationId, userId]
    );

    if (convCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "You are not part of this conversation")],
      });
    }

    const conversation = convCheck.rows[0];
    const receiverId = conversation.receiverid;

    // Insert message
    const result = await query(
      `INSERT INTO "Message" 
       ("MessageID", "ConversationID", "SenderID", "ReceiverID", "Content", "MessageType", 
        "ReplyToID", "IsRead", "CreatedAt", "UpdatedAt")
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, false, NOW(), NOW())
       RETURNING *`,
      [conversationId, userId, receiverId, content.trim(), messageType, replyToId || null]
    );

    const message = result.rows[0];

    // Update conversation's last message
    await query(
      `UPDATE "Conversation" 
       SET "LastMessage" = $1, "LastMessageAt" = NOW(), "UpdatedAt" = NOW()
       WHERE "ConversationID" = $2::uuid`,
      [content.trim().substring(0, 100), conversationId]
    );

    // Get sender info
    const senderInfo = await query(
      `SELECT "FullName", "ProfileImageURL" FROM "User" WHERE "UserID" = $1::uuid`,
      [userId]
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

// Delete message (soft delete for user)
export const deleteMessage = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { messageId } = req.params;

    const messageCheck = await query(
      `SELECT * FROM "Message" WHERE "MessageID" = $1::uuid`,
      [messageId]
    );

    if (messageCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("message", "Message not found")],
      });
    }

    const message = messageCheck.rows[0];

    // If sender deletes
    if (message.SenderID === userId) {
      await query(
        `UPDATE "Message" 
         SET "IsDeleted" = true, "UpdatedAt" = NOW()
         WHERE "MessageID" = $1::uuid`,
        [messageId]
      );
    } else {
      // If receiver deletes, add to DeletedFor array
      let deletedFor = message.DeletedFor || [];
      if (!deletedFor.includes(userId)) {
        deletedFor.push(userId);
        await query(
          `UPDATE "Message" 
           SET "DeletedFor" = $1, "UpdatedAt" = NOW()
           WHERE "MessageID" = $2::uuid`,
          [deletedFor, messageId]
        );
      }
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

// Get total unread count
export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;

    const result = await query(
      `SELECT COUNT(*) as unread_count
       FROM "Message" m
       JOIN "Conversation" c ON m."ConversationID" = c."ConversationID"
       WHERE (c."Participant1ID" = $1::uuid OR c."Participant2ID" = $1::uuid)
         AND m."SenderID" != $1::uuid 
         AND m."IsRead" = false
         AND m."IsDeleted" = false`,
      [userId]
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

// Search users to start a new chat
export const searchUsers = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { q } = req.query;
    const limit = getQueryNumber(req.query.limit, 20);

    if (!q || typeof q !== 'string') {
      return res.status(400).json({
        success: false,
        errors: [formatError("search", "Search query is required")],
      });
    }

    const result = await query(
      `SELECT "UserID", "FullName", "Email", "ProfileImageURL", "Role", "IsOnline"
       FROM "User" 
       WHERE "UserID" != $1::uuid 
         AND ("FullName" ILIKE $2 OR "Email" ILIKE $2)
         AND "Status" = 'Active'
       LIMIT $3`,
      [userId, `%${q}%`, limit]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("[Chat] Search users error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to search users")],
    });
  }
});