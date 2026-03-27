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
    const { timeSlots } = req.body; // Array of { startTime, endTime }

    if (!timeSlots || !Array.isArray(timeSlots)) {
      return res.status(400).json({
        success: false,
        errors: [formatError("timeSlots", "Time slots array is required")],
      });
    }

    // Check if user is part of the session
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

    // Notify the other participant
    const session = sessionCheck.rows[0];
    const otherUserId = session.MentorID === userId ? session.LearnerID : session.MentorID;

    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data")
       VALUES (gen_random_uuid(), $1, 'NEW_MESSAGE', $2, $3, $4)`,
      [otherUserId, "New Time Slots Proposed", "Time slots have been proposed for your session",
       JSON.stringify({ sessionId, count: inserted.length })]
    );

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

// Select a time slot
export const selectTimeSlot = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId, timeSlotId } = req.params;

    // Check if user is part of the session
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

    // Get the time slot
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

    // Mark as selected
    await query(
      `UPDATE "TimeSlot" 
       SET "IsSelected" = true, "SelectedBy" = $1
       WHERE "TimeSlotID" = $2`,
      [userId, timeSlotId]
    );

    // Get the session
    const session = sessionCheck.rows[0];
    const selectedSlot = timeSlot.rows[0];

    // Update session with scheduled time
    await query(
      `UPDATE "Session" 
       SET "ScheduledStart" = $1, "ScheduledEnd" = $2, "Status" = 'SCHEDULED', "UpdatedAt" = NOW()
       WHERE "SessionID" = $3`,
      [selectedSlot.StartTime, selectedSlot.EndTime, sessionId]
    );

    // Generate meeting link (using Google Meet)
    const meetingRoomId = uuidv4();
    const meetingLink = `https://meet.google.com/${meetingRoomId.substring(0, 10)}`;

    await query(
      `UPDATE "Session" 
       SET "MeetingLink" = $1, "MeetingRoomId" = $2
       WHERE "SessionID" = $3`,
      [meetingLink, meetingRoomId, sessionId]
    );

    // Notify both participants
    const otherUserId = session.MentorID === userId ? session.LearnerID : session.MentorID;

    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data")
       VALUES 
       (gen_random_uuid(), $1, 'SESSION_SCHEDULED', $2, $3, $4),
       (gen_random_uuid(), $5, 'SESSION_SCHEDULED', $6, $7, $8)`,
      [
        userId, "Session Scheduled", `Your session is scheduled for ${selectedSlot.StartTime}`, 
        JSON.stringify({ sessionId, meetingLink }),
        otherUserId, "Session Scheduled", `Your session is scheduled for ${selectedSlot.StartTime}`,
        JSON.stringify({ sessionId, meetingLink })
      ]
    );

    return res.status(200).json({
      success: true,
      data: {
        scheduledStart: selectedSlot.StartTime,
        scheduledEnd: selectedSlot.EndTime,
        meetingLink,
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

// Start session (generate meeting link)
export const startSession = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;

    // Check if user is mentor of this session
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

    if (session.Status !== 'SCHEDULED') {
      return res.status(400).json({
        success: false,
        errors: [formatError("status", "Session cannot be started")],
      });
    }

    // Update session status
    await query(
      `UPDATE "Session" 
       SET "Status" = 'IN_PROGRESS', "ActualStartTime" = NOW(), "UpdatedAt" = NOW()
       WHERE "SessionID" = $1`,
      [sessionId]
    );

    // Add participants
    await query(
      `INSERT INTO "SessionParticipant" 
       ("ParticipantID", "SessionID", "UserID", "Role", "JoinedAt")
       VALUES 
       (gen_random_uuid(), $1, $2, 'mentor', NOW()),
       (gen_random_uuid(), $1, $3, 'learner', NOW())`,
      [sessionId, session.MentorID, session.LearnerID]
    );

    // Notify learner
    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data")
       VALUES (gen_random_uuid(), $1, 'SESSION_REMINDER', $2, $3, $4)`,
      [session.LearnerID, "Session Started", `Your session has started. Join now!`,
       JSON.stringify({ sessionId, meetingLink: session.MeetingLink })]
    );

    return res.status(200).json({
      success: true,
      data: {
        meetingLink: session.MeetingLink,
        meetingRoomId: session.MeetingRoomId,
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

    // Check if user is mentor of this session
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

    // Update session
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

    // Update participants
    await query(
      `UPDATE "SessionParticipant" 
       SET "LeftAt" = NOW(), "IsActive" = false
       WHERE "SessionID" = $1`,
      [sessionId]
    );

    // Notify learner
    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data")
       VALUES (gen_random_uuid(), $1, 'SESSION_COMPLETED', $2, $3, $4)`,
      [session.LearnerID, "Session Completed", `Your session with ${(req as any).user?.FullName} has ended. Please leave a review!`,
       JSON.stringify({ sessionId })]
    );

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