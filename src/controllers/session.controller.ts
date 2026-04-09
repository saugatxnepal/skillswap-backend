// src/controllers/session.controller.ts
import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";
import { v4 as uuidv4 } from "uuid";

enum SessionStatus {
  PENDING_MATCH = "PENDING_MATCH",
  SCHEDULED = "SCHEDULED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  REPORTED = "REPORTED",
}

// Get available time slots for a session
export const getAvailableTimeSlots = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const result = await query(
      `SELECT ts.*, u."FullName" as "UserName"
       FROM "TimeSlot" ts
       JOIN "User" u ON ts."UserID" = u."UserID"
       WHERE ts."SessionID" = $1 AND ts."IsAvailable" = true AND ts."IsSelected" = false
       ORDER BY ts."StartTime"`,
      [sessionId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Get available time slots error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch time slots")],
    });
  }
});

// Propose time slots (by learner or mentor)
export const proposeTimeSlots = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;
    const { timeSlots } = req.body;

    if (!timeSlots || !Array.isArray(timeSlots)) {
      return res.status(400).json({
        success: false,
        errors: [formatError("timeSlots", "Time slots array is required")],
      });
    }

    const sessionCheck = await query(
      `SELECT * FROM "Session" WHERE "SessionID" = $1 AND ("MentorID" = $2 OR "LearnerID" = $2)`,
      [sessionId, userId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "You are not part of this session")],
      });
    }

    const inserted = [];
    for (const slot of timeSlots) {
      const result = await query(
        `INSERT INTO "TimeSlot" 
         ("TimeSlotID", "SessionID", "UserID", "StartTime", "EndTime", "IsAvailable", "IsSelected")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, true, false)
         RETURNING *`,
        [sessionId, userId, slot.startTime, slot.endTime]
      );
      inserted.push(result.rows[0]);
    }

    const session = sessionCheck.rows[0];
    const otherUserId = session.MentorID === userId ? session.LearnerID : session.MentorID;

    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
       VALUES (gen_random_uuid(), $1, 'NEW_MESSAGE', $2, $3, $4, NOW())`,
      [otherUserId, "New Time Slots Proposed", "Time slots have been proposed for your session",
       JSON.stringify({ sessionId, count: inserted.length })]
    );

    // Emit socket event for real-time update
    const io = req.app.get("io");
    if (io) {
      io.emit("session:slots-proposed", { sessionId });
    }

    return res.status(201).json({
      success: true,
      data: inserted,
      message: "Time slots proposed successfully",
    });
  } catch (error) {
    console.error("Propose time slots error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to propose time slots")],
    });
  }
});

// Select a time slot - Generates WebRTC room ID (no Google Meet)
export const selectTimeSlot = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId, timeSlotId } = req.params;

    const sessionCheck = await query(
      `SELECT * FROM "Session" WHERE "SessionID" = $1 AND ("MentorID" = $2 OR "LearnerID" = $2)`,
      [sessionId, userId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "You are not part of this session")],
      });
    }

    const timeSlot = await query(
      `SELECT * FROM "TimeSlot" WHERE "TimeSlotID" = $1 AND "SessionID" = $2`,
      [timeSlotId, sessionId]
    );

    if (timeSlot.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("timeSlot", "Time slot not found")],
      });
    }

    await query(
      `UPDATE "TimeSlot" 
       SET "IsSelected" = true, "SelectedBy" = $1
       WHERE "TimeSlotID" = $2`,
      [userId, timeSlotId]
    );

    const session = sessionCheck.rows[0];
    const selectedSlot = timeSlot.rows[0];

    // Generate unique WebRTC room ID (no Google Meet)
    const roomId = uuidv4();

    await query(
      `UPDATE "Session" 
       SET "ScheduledStart" = $1, 
           "ScheduledEnd" = $2, 
           "Status" = 'SCHEDULED', 
           "MeetingRoomId" = $3,
           "MeetingProvider" = 'webrtc',
           "MeetingLink" = NULL,
           "UpdatedAt" = NOW()
       WHERE "SessionID" = $4`,
      [selectedSlot.StartTime, selectedSlot.EndTime, roomId, sessionId]
    );

    const otherUserId = session.MentorID === userId ? session.LearnerID : session.MentorID;

    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
       VALUES 
       (gen_random_uuid(), $1, 'SESSION_SCHEDULED', $2, $3, $4, NOW()),
       (gen_random_uuid(), $5, 'SESSION_SCHEDULED', $6, $7, $8, NOW())`,
      [
        userId, "Session Scheduled", `Your session is scheduled for ${selectedSlot.StartTime}`, 
        JSON.stringify({ sessionId, roomId }),
        otherUserId, "Session Scheduled", `Your session is scheduled for ${selectedSlot.StartTime}`,
        JSON.stringify({ sessionId, roomId })
      ]
    );

    // Emit socket event for real-time update
    const io = req.app.get("io");
    if (io) {
      io.emit("session:scheduled", { sessionId, title: session.Title });
    }

    return res.status(200).json({
      success: true,
      data: {
        scheduledStart: selectedSlot.StartTime,
        scheduledEnd: selectedSlot.EndTime,
        roomId,
      },
      message: "Time slot selected and session scheduled",
    });
  } catch (error) {
    console.error("Select time slot error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to select time slot")],
    });
  }
});

// Start session (update status only - WebRTC handled by frontend)
export const startSession = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;

    const sessionCheck = await query(
      `SELECT * FROM "Session" WHERE "SessionID" = $1 AND "MentorID" = $2`,
      [sessionId, userId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only the mentor can start the session")],
      });
    }

    const session = sessionCheck.rows[0];

    // If already in progress, just return success (idempotency)
    if (session.Status === 'IN_PROGRESS') {
      return res.status(200).json({
        success: true,
        data: {
          roomId: session.MeetingRoomId,
        },
        message: "Session is already in progress",
      });
    }

    if (session.Status !== 'SCHEDULED') {
      return res.status(400).json({
        success: false,
        errors: [formatError("status", `Session cannot be started. Current status: ${session.Status}`)],
      });
    }

    await query(
      `UPDATE "Session" 
       SET "Status" = 'IN_PROGRESS', "ActualStartTime" = NOW(), "UpdatedAt" = NOW()
       WHERE "SessionID" = $1`,
      [sessionId]
    );

    // Add participants only if they don't exist yet
    await query(
      `INSERT INTO "SessionParticipant" ("ParticipantID", "SessionID", "UserID", "Role", "JoinedAt", "CreatedAt")
       SELECT gen_random_uuid(), $1, $2, 'mentor', NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM "SessionParticipant" WHERE "SessionID" = $1 AND "UserID" = $2)`,
      [sessionId, session.MentorID]
    );
    
    await query(
      `INSERT INTO "SessionParticipant" ("ParticipantID", "SessionID", "UserID", "Role", "JoinedAt", "CreatedAt")
       SELECT gen_random_uuid(), $1, $2, 'learner', NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM "SessionParticipant" WHERE "SessionID" = $1 AND "UserID" = $2)`,
      [sessionId, session.LearnerID]
    );

    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
       VALUES (gen_random_uuid(), $1, 'SESSION_REMINDER', $2, $3, $4, NOW())`,
      [session.LearnerID, "Session Started", `Your session has started. Join now!`,
       JSON.stringify({ sessionId, roomId: session.MeetingRoomId })]
    );

    // Emit socket event for real-time update
    const io = req.app.get("io");
    if (io) {
      io.emit("session:started", { 
        sessionId, 
        title: session.Title, 
        roomId: session.MeetingRoomId 
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        roomId: session.MeetingRoomId,
      },
      message: "Session started",
    });
  } catch (error) {
    console.error("Start session error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to start session")],
    });
  }
});

// End session
export const endSession = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;

    const sessionCheck = await query(
      `SELECT * FROM "Session" WHERE "SessionID" = $1 AND "MentorID" = $2`,
      [sessionId, userId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only the mentor can end the session")],
      });
    }

    const result = await query(
      `UPDATE "Session" 
       SET "Status" = 'COMPLETED', "ActualEndTime" = NOW(), 
           "Duration" = EXTRACT(EPOCH FROM (NOW() - "ActualStartTime")) / 60,
           "UpdatedAt" = NOW()
       WHERE "SessionID" = $1
       RETURNING *`,
      [sessionId]
    );

    const session = result.rows[0];

    await query(
      `UPDATE "SessionParticipant" 
       SET "LeftAt" = NOW(), "IsActive" = false
       WHERE "SessionID" = $1`,
      [sessionId]
    );

    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
       VALUES (gen_random_uuid(), $1, 'SESSION_COMPLETED', $2, $3, $4, NOW())`,
      [session.LearnerID, "Session Completed", `Your session with ${(req as any).user?.fullName} has ended. Please leave a review!`,
       JSON.stringify({ sessionId })]
    );

    // Emit socket event for real-time update
    const io = req.app.get("io");
    if (io) {
      io.emit("session:ended", { sessionId });
    }

    return res.status(200).json({
      success: true,
      data: session,
      message: "Session ended",
    });
  } catch (error) {
    console.error("End session error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to end session")],
    });
  }
});

// Get session meeting info (for WebRTC)
export const getSessionMeetingInfo = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;

    const result = await query(
      `SELECT s."SessionID", s."MeetingRoomId", s."Status", s."ScheduledStart", s."ScheduledEnd",
              m."FullName" as "mentorName", m."UserID" as "mentorId",
              l."FullName" as "learnerName", l."UserID" as "learnerId"
       FROM "Session" s
       JOIN "User" m ON s."MentorID" = m."UserID"
       JOIN "User" l ON s."LearnerID" = l."UserID"
       WHERE s."SessionID" = $1 AND (s."MentorID" = $2 OR s."LearnerID" = $2)`,
      [sessionId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("session", "Session not found")],
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Get session meeting info error:", error);
    return res.status(500).json({  
      success: false,
      errors: [formatError("server", "Failed to get meeting info")],
    });
  }
});