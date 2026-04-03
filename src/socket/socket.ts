// src/socket/socket.ts
import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/env';
import { query } from '../db';

interface SocketUser {
  userId: string;
  role: string;
  fullName: string;
  profileImage?: string;
  socketId: string;
}

// Store online users
const onlineUsers = new Map<string, SocketUser>();
// Store socket references for direct messaging
const socketRefs = new Map<string, Socket>();

export const setupSocket = (server: HttpServer) => {
  const io = new SocketServer(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, JWT_SECRET) as any;
      
      // REMOVED ::uuid casting - use direct comparison
      const userResult = await query(
        `SELECT "UserID", "Role", "FullName", "ProfileImageURL" 
         FROM "User" WHERE "UserID" = $1 AND "Status" = 'Active'`,
        [decoded.id]
      );

      if (userResult.rows.length === 0) {
        return next(new Error('User not found or inactive'));
      }

      const user = userResult.rows[0];
      socket.data.user = {
        userId: user.UserID,
        role: user.Role,
        fullName: user.FullName,
        profileImage: user.ProfileImageURL,
      };
      
      next();
    } catch (err) {
      console.error('[Socket] Auth error:', err);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    console.log(`[Socket] User connected: ${user.fullName} (${user.userId})`);

    // Store socket reference
    socketRefs.set(user.userId, socket);

    // Update user online status in database - REMOVED ::uuid
    query(
      `UPDATE "User" SET "IsOnline" = true, "LastSeen" = NOW() WHERE "UserID" = $1`,
      [user.userId]
    ).catch(console.error);

    // Store user as online
    onlineUsers.set(user.userId, {
      userId: user.userId,
      role: user.role,
      fullName: user.fullName,
      profileImage: user.profileImage,
      socketId: socket.id,
    });

    // Broadcast user online status
    io.emit('user:online', {
      userId: user.userId,
      fullName: user.fullName,
      role: user.role,
    });

    // ==================== CONVERSATION ROOM MANAGEMENT ====================
    
    // Join conversation room for DM
    socket.on('conversation:join', (conversationId: string) => {
      socket.join(`conversation:${conversationId}`);
      console.log(`[Socket] User ${user.fullName} joined conversation ${conversationId}`);
    });

    // Leave conversation room
    socket.on('conversation:leave', (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
      console.log(`[Socket] User ${user.fullName} left conversation ${conversationId}`);
    });

    // ==================== DIRECT MESSAGING ====================

    // Send DM message
    socket.on('chat:send', async (data) => {
      const { conversationId, content, messageType = 'TEXT', replyToId } = data;
      
      try {
        // Get conversation details - REMOVED ::uuid
        const convResult = await query(
          `SELECT c.*, 
                  CASE WHEN c."Participant1ID" = $2 THEN c."Participant2ID" ELSE c."Participant1ID" END as "ReceiverID"
           FROM "Conversation" c
           WHERE c."ConversationID" = $1`,
          [conversationId, user.userId]
        );
        
        if (convResult.rows.length === 0) {
          socket.emit('chat:error', { error: 'Conversation not found' });
          return;
        }
        
        const conversation = convResult.rows[0];
        const receiverId = conversation.receiverid;
        
        // Insert message - REMOVED ::uuid
        const result = await query(
          `INSERT INTO "Message" 
           ("MessageID", "ConversationID", "SenderID", "ReceiverID", "Content", "MessageType", 
            "ReplyToID", "IsRead", "CreatedAt", "UpdatedAt")
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, false, NOW(), NOW())
           RETURNING *`,
          [conversationId, user.userId, receiverId, content, messageType, replyToId || null]
        );
        
        const message = result.rows[0];
        
        // Update conversation - REMOVED ::uuid
        await query(
          `UPDATE "Conversation" 
           SET "LastMessage" = $1, "LastMessageAt" = NOW(), "UpdatedAt" = NOW()
           WHERE "ConversationID" = $2`,
          [content.substring(0, 100), conversationId]
        );
        
        // Get sender info
        const senderInfo = {
          MessageID: message.MessageID,
          ConversationID: message.ConversationID,
          SenderID: message.SenderID,
          Content: message.Content,
          MessageType: message.MessageType,
          CreatedAt: message.CreatedAt,
          senderName: user.fullName,
          senderImage: user.profileImage,
        };
        
        // Broadcast to everyone in the conversation room (including sender)
        io.to(`conversation:${conversationId}`).emit('chat:new', senderInfo);
        
        // Create notification for offline user
        await query(
          `INSERT INTO "Notification" 
           ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
           VALUES (gen_random_uuid(), $1, 'NEW_MESSAGE', $2, $3, $4, NOW())`,
          [receiverId, "New Message", 
           `${user.fullName} sent you a message: ${content.substring(0, 50)}...`,
           JSON.stringify({ conversationId, messageId: message.MessageID })]
        );
        
      } catch (error) {
        console.error('[Socket] Chat send error:', error);
        socket.emit('chat:error', { error: 'Failed to send message' });
      }
    });

    // Typing indicator for DM
    socket.on('chat:typing:start', async ({ conversationId }) => {
      const convResult = await query(
        `SELECT * FROM "Conversation" WHERE "ConversationID" = $1`,
        [conversationId]
      );
      
      if (convResult.rows.length === 0) return;
      
      const conversation = convResult.rows[0];
      const otherUserId = conversation.Participant1ID === user.userId 
        ? conversation.Participant2ID 
        : conversation.Participant1ID;
      
      const recipientSocket = socketRefs.get(otherUserId);
      if (recipientSocket && recipientSocket.connected) {
        recipientSocket.emit('chat:typing', {
          userId: user.userId,
          fullName: user.fullName,
          isTyping: true,
        });
      }
    });

    socket.on('chat:typing:stop', async ({ conversationId }) => {
      const convResult = await query(
        `SELECT * FROM "Conversation" WHERE "ConversationID" = $1`,
        [conversationId]
      );
      
      if (convResult.rows.length === 0) return;
      
      const conversation = convResult.rows[0];
      const otherUserId = conversation.Participant1ID === user.userId 
        ? conversation.Participant2ID 
        : conversation.Participant1ID;
      
      const recipientSocket = socketRefs.get(otherUserId);
      if (recipientSocket && recipientSocket.connected) {
        recipientSocket.emit('chat:typing', {
          userId: user.userId,
          fullName: user.fullName,
          isTyping: false,
        });
      }
    });

    // Mark messages as read in DM
    socket.on('chat:read', async ({ conversationId, messageIds }) => {
      if (!messageIds || messageIds.length === 0) return;
      
      await query(
        `UPDATE "Message" 
         SET "IsRead" = true, "ReadAt" = NOW()
         WHERE "MessageID" = ANY($1::text[]) AND "SenderID" != $2`,
        [messageIds, user.userId]
      );
      
      // Notify sender
      const convResult = await query(
        `SELECT * FROM "Conversation" WHERE "ConversationID" = $1`,
        [conversationId]
      );
      
      if (convResult.rows.length === 0) return;
      
      const conversation = convResult.rows[0];
      const otherUserId = conversation.Participant1ID === user.userId 
        ? conversation.Participant2ID 
        : conversation.Participant1ID;
      
      const recipientSocket = socketRefs.get(otherUserId);
      if (recipientSocket && recipientSocket.connected) {
        recipientSocket.emit('chat:read-receipt', { 
          messageIds, 
          readBy: user.userId,
          readAt: new Date().toISOString()
        });
      }
    });

    // ==================== SESSION CHAT (Legacy) ====================

    // Join session room
    socket.on('session:join', async (sessionId: string) => {
      const sessionCheck = await query(
        `SELECT * FROM "Session" 
         WHERE "SessionID" = $1 AND ("MentorID" = $2 OR "LearnerID" = $2)`,
        [sessionId, user.userId]
      );

      if (sessionCheck.rows.length > 0) {
        socket.join(`session:${sessionId}`);
        console.log(`[Socket] User ${user.fullName} joined session ${sessionId}`);
        
        socket.to(`session:${sessionId}`).emit('session:user-joined', {
          userId: user.userId,
          fullName: user.fullName,
          role: user.role,
        });
      }
    });

    // Leave session room
    socket.on('session:leave', (sessionId: string) => {
      socket.leave(`session:${sessionId}`);
      socket.to(`session:${sessionId}`).emit('session:user-left', {
        userId: user.userId,
        fullName: user.fullName,
      });
    });

    // Session message send
    socket.on('message:send', async (data) => {
      const { sessionId, content, messageType = 'TEXT', fileUrl, fileName, replyToId } = data;
      
      try {
        const sessionCheck = await query(
          `SELECT * FROM "Session" 
           WHERE "SessionID" = $1 AND ("MentorID" = $2 OR "LearnerID" = $2)`,
          [sessionId, user.userId]
        );

        if (sessionCheck.rows.length === 0) {
          socket.emit('message:error', { error: 'You are not part of this session' });
          return;
        }

        const session = sessionCheck.rows[0];
        
        const result = await query(
          `INSERT INTO "Message" 
           ("MessageID", "SessionID", "SenderID", "Content", "MessageType", 
            "FileURL", "FileName", "ReplyToID", "CreatedAt", "UpdatedAt")
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
           RETURNING *`,
          [sessionId, user.userId, content, messageType, fileUrl || null, fileName || null, replyToId || null]
        );

        const message = result.rows[0];
        
        const messageWithSender = {
          ...message,
          senderName: user.fullName,
          senderRole: user.role,
          senderImage: user.profileImage,
        };

        io.to(`session:${sessionId}`).emit('message:new', messageWithSender);

        const otherUserId = session.MentorID === user.userId ? session.LearnerID : session.MentorID;
        
        await query(
          `INSERT INTO "Notification" 
           ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
           VALUES (gen_random_uuid(), $1, 'NEW_MESSAGE', $2, $3, $4, NOW())`,
          [otherUserId, "New Message", 
           `${user.fullName} sent a message: ${content.substring(0, 50)}...`,
           JSON.stringify({ sessionId, messageId: message.MessageID })]
        );

      } catch (error) {
        console.error('[Socket] Send message error:', error);
        socket.emit('message:error', { error: 'Failed to send message' });
      }
    });

    // Mark session message as read
    socket.on('message:read', async (data: { sessionId: string, messageIds: string[] }) => {
      const { sessionId, messageIds } = data;
      
      try {
        await query(
          `UPDATE "Message" 
           SET "ReadAt" = NOW()
           WHERE "MessageID" = ANY($1::text[]) 
             AND "SessionID" = $2 
             AND "SenderID" != $3`,
          [messageIds, sessionId, user.userId]
        );
        
        socket.to(`session:${sessionId}`).emit('message:read-receipt', {
          messageIds,
          readBy: user.userId,
          readAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('[Socket] Mark read error:', error);
      }
    });

    // Typing indicator for session
    socket.on('typing:start', (data: { sessionId: string }) => {
      socket.to(`session:${data.sessionId}`).emit('typing:indicator', {
        userId: user.userId,
        fullName: user.fullName,
        isTyping: true,
      });
    });

    socket.on('typing:stop', (data: { sessionId: string }) => {
      socket.to(`session:${data.sessionId}`).emit('typing:indicator', {
        userId: user.userId,
        fullName: user.fullName,
        isTyping: false,
      });
    });

    // Edit message
    socket.on('message:edit', async (data: { messageId: string, content: string }) => {
      const { messageId, content } = data;
      
      try {
        const result = await query(
          `UPDATE "Message" 
           SET "Content" = $1, "IsEdited" = true, "EditedAt" = NOW()
           WHERE "MessageID" = $2 AND "SenderID" = $3
           RETURNING "SessionID", "ConversationID"`,
          [content, messageId, user.userId]
        );

        if (result.rows.length > 0) {
          const { SessionID, ConversationID } = result.rows[0];
          if (SessionID) {
            io.to(`session:${SessionID}`).emit('message:edited', {
              messageId,
              content,
              editedAt: new Date().toISOString(),
            });
          } else if (ConversationID) {
            const convResult = await query(
              `SELECT * FROM "Conversation" WHERE "ConversationID" = $1`,
              [ConversationID]
            );
            if (convResult.rows.length > 0) {
              const conversation = convResult.rows[0];
              const otherUserId = conversation.Participant1ID === user.userId 
                ? conversation.Participant2ID 
                : conversation.Participant1ID;
              
              const recipientSocket = socketRefs.get(otherUserId);
              if (recipientSocket && recipientSocket.connected) {
                recipientSocket.emit('chat:message-edited', {
                  messageId,
                  content,
                  editedAt: new Date().toISOString(),
                });
              }
              socket.emit('chat:message-edited', {
                messageId,
                content,
                editedAt: new Date().toISOString(),
              });
            }
          }
        }
      } catch (error) {
        console.error('[Socket] Edit message error:', error);
      }
    });

    // Delete message
    socket.on('message:delete', async (data: { messageId: string }) => {
      const { messageId } = data;
      
      try {
        const result = await query(
          `UPDATE "Message" 
           SET "IsDeleted" = true, "UpdatedAt" = NOW()
           WHERE "MessageID" = $1 AND "SenderID" = $2
           RETURNING "SessionID", "ConversationID"`,
          [messageId, user.userId]
        );

        if (result.rows.length > 0) {
          const { SessionID, ConversationID } = result.rows[0];
          if (SessionID) {
            io.to(`session:${SessionID}`).emit('message:deleted', { messageId });
          } else if (ConversationID) {
            const convResult = await query(
              `SELECT * FROM "Conversation" WHERE "ConversationID" = $1`,
              [ConversationID]
            );
            if (convResult.rows.length > 0) {
              const conversation = convResult.rows[0];
              const otherUserId = conversation.Participant1ID === user.userId 
                ? conversation.Participant2ID 
                : conversation.Participant1ID;
              
              const recipientSocket = socketRefs.get(otherUserId);
              if (recipientSocket && recipientSocket.connected) {
                recipientSocket.emit('chat:message-deleted', { messageId });
              }
              socket.emit('chat:message-deleted', { messageId });
            }
          }
        }
      } catch (error) {
        console.error('[Socket] Delete message error:', error);
      }
    });

    // Get online users in session
    socket.on('session:get-online-users', (sessionId: string, callback) => {
      const room = io.sockets.adapter.rooms.get(`session:${sessionId}`);
      const onlineUserIds: string[] = [];
      
      if (room) {
        for (const socketId of room) {
          const socketUser = Array.from(onlineUsers.values()).find(u => u.socketId === socketId);
          if (socketUser) {
            onlineUserIds.push(socketUser.userId);
          }
        }
      }
      
      callback({ onlineUserIds });
    });

    // Disconnect
    socket.on('disconnect', async () => {
      console.log(`[Socket] User disconnected: ${user.fullName}`);
      
      // Remove from online users
      onlineUsers.delete(user.userId);
      socketRefs.delete(user.userId);
      
      // Update user offline status in database - REMOVED ::uuid
      await query(
        `UPDATE "User" SET "IsOnline" = false, "LastSeen" = NOW() WHERE "UserID" = $1`,
        [user.userId]
      ).catch(console.error);
      
      // Broadcast user offline status
      io.emit('user:offline', {
        userId: user.userId,
        fullName: user.fullName,
      });
    });
  });

  return io;
};

// Helper to get online users
export const getOnlineUsers = () => {
  return Array.from(onlineUsers.values());
};

// Helper to check if user is online
export const isUserOnline = (userId: string): boolean => {
  return onlineUsers.has(userId);
};