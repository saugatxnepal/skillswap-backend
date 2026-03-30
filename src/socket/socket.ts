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
  socketId: string;
}

// Store online users
const onlineUsers = new Map<string, SocketUser>();

export const setupSocket = (server: HttpServer) => {
  const io = new SocketServer(server, {
    cors: {
      origin: process.env.FRONTEND_URL || '*',
      credentials: true,
    },
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, JWT_SECRET) as any;
      
      const userResult = await query(
        `SELECT "UserID", "Role", "FullName" FROM "User" WHERE "UserID" = $1 AND "Status" = 'Active'`,
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
      };
      
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    console.log(`[Socket] User connected: ${user.fullName} (${user.userId})`);

    // Store user as online
    onlineUsers.set(user.userId, {
      userId: user.userId,
      role: user.role,
      fullName: user.fullName,
      socketId: socket.id,
    });

    // Broadcast user online status
    io.emit('user:online', {
      userId: user.userId,
      fullName: user.fullName,
      role: user.role,
    });

    // Join session room
    socket.on('session:join', async (sessionId: string) => {
      // Check if user is part of the session
      const sessionCheck = await query(
        `SELECT * FROM "Session" 
         WHERE "SessionID" = $1 AND ("MentorID" = $2 OR "LearnerID" = $2)`,
        [sessionId, user.userId]
      );

      if (sessionCheck.rows.length > 0) {
        socket.join(`session:${sessionId}`);
        console.log(`[Socket] User ${user.fullName} joined session ${sessionId}`);
        
        // Notify others in the session
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
      console.log(`[Socket] User ${user.fullName} left session ${sessionId}`);
      
      socket.to(`session:${sessionId}`).emit('session:user-left', {
        userId: user.userId,
        fullName: user.fullName,
      });
    });

    // Send message
    socket.on('message:send', async (data) => {
      const { sessionId, content, messageType = 'TEXT', fileUrl, fileName, replyToId } = data;
      
      try {
        // Verify user is part of the session
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
        
        // Insert message into database
        const result = await query(
          `INSERT INTO "Message" 
           ("MessageID", "SessionID", "SenderID", "Content", "MessageType", 
            "FileURL", "FileName", "ReplyToID", "CreatedAt")
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())
           RETURNING *`,
          [sessionId, user.userId, content, messageType, fileUrl || null, fileName || null, replyToId || null]
        );

        const message = result.rows[0];
        
        // Add sender info to message
        const messageWithSender = {
          ...message,
          senderName: user.fullName,
          senderRole: user.role,
        };

        // Broadcast to everyone in the session room
        io.to(`session:${sessionId}`).emit('message:new', messageWithSender);

        // Notify the other participant (for push notification)
        const otherUserId = session.MentorID === user.userId ? session.LearnerID : session.MentorID;
        
        // Create notification for offline user
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

    // Mark message as read
    socket.on('message:read', async (data: { sessionId: string, messageIds: string[] }) => {
      const { sessionId, messageIds } = data;
      
      try {
        await query(
          `UPDATE "Message" 
           SET "ReadAt" = NOW()
           WHERE "MessageID" = ANY($1::uuid[]) 
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

    // Typing indicator
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
           RETURNING "SessionID"`,
          [content, messageId, user.userId]
        );

        if (result.rows.length > 0) {
          const sessionId = result.rows[0].SessionID;
          io.to(`session:${sessionId}`).emit('message:edited', {
            messageId,
            content,
            editedAt: new Date().toISOString(),
          });
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
          `DELETE FROM "Message" 
           WHERE "MessageID" = $1 AND "SenderID" = $2
           RETURNING "SessionID"`,
          [messageId, user.userId]
        );

        if (result.rows.length > 0) {
          const sessionId = result.rows[0].SessionID;
          io.to(`session:${sessionId}`).emit('message:deleted', { messageId });
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
    socket.on('disconnect', () => {
      console.log(`[Socket] User disconnected: ${user.fullName}`);
      onlineUsers.delete(user.userId);
      
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