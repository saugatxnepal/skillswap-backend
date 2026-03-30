// src/controllers/sessionInvite.controller.ts
import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";

enum InviteStatus {
  PENDING = "PENDING",
  ACCEPTED = "ACCEPTED",
  DECLINED = "DECLINED",
  EXPIRED = "EXPIRED",
}

enum SessionStatus {
  PENDING_MATCH = "PENDING_MATCH",
  SCHEDULED = "SCHEDULED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

// Helper functions
const getQueryNumber = (param: any, defaultValue: number): number => {
  if (!param) return defaultValue;
  const num = parseInt(param, 10);
  return isNaN(num) ? defaultValue : num;
};

const getQueryString = (param: any): string | undefined => {
  if (typeof param === 'string') return param;
  if (Array.isArray(param)) return param[0];
  return undefined;
};

// Send an invite to a user for a session
export const sendInvite = asyncHandler(async (req: Request, res: Response) => {
  try {
    const inviterId = (req as any).user?.UserID;
    const { sessionId } = req.params;
    const { inviteeId, message, expiresInHours = 48 } = req.body;

    if (!inviteeId) {
      return res.status(400).json({
        success: false,
        errors: [formatError("inviteeId", "Invitee ID is required")],
      });
    }

    // Check if session exists and user is part of it
    const sessionCheck = await query(
      `SELECT * FROM "Session" 
       WHERE "SessionID" = $1 AND ("MentorID" = $2 OR "LearnerID" = $2)`,
      [sessionId, inviterId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("session", "Session not found or you are not part of it")],
      });
    }

    const session = sessionCheck.rows[0];

    // Check if session is still active for invites
    if (session.Status !== SessionStatus.PENDING_MATCH && 
        session.Status !== SessionStatus.SCHEDULED) {
      return res.status(400).json({
        success: false,
        errors: [formatError("session", "Cannot send invites for completed or cancelled sessions")],
      });
    }

    // Check if invitee exists and is active
    const inviteeCheck = await query(
      `SELECT "UserID", "FullName", "Email", "Role" FROM "User" 
       WHERE "UserID" = $1 AND "Status" = 'Active'`,
      [inviteeId]
    );

    if (inviteeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("invitee", "User not found or inactive")],
      });
    }

    const invitee = inviteeCheck.rows[0];

    // Check if invite already exists
    const existingInvite = await query(
      `SELECT * FROM "SessionInvite" 
       WHERE "SessionID" = $1 AND "InviteeID" = $2 AND "Status" = 'PENDING'`,
      [sessionId, inviteeId]
    );

    if (existingInvite.rows.length > 0) {
      return res.status(400).json({
        success: false,
        errors: [formatError("invite", "An active invite already exists for this user")],
      });
    }

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiresInHours);

    // Create invite
    const result = await query(
      `INSERT INTO "SessionInvite" 
       ("InviteID", "SessionID", "InviterID", "InviteeID", "Message", "ExpiresAt", "Status", "CreatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'PENDING', NOW())
       RETURNING *`,
      [sessionId, inviterId, inviteeId, message || null, expiresAt]
    );

    const newInvite = result.rows[0];

    // Get inviter details
    const inviterResult = await query(
      `SELECT "FullName" FROM "User" WHERE "UserID" = $1`,
      [inviterId]
    );
    const inviterName = inviterResult.rows[0]?.FullName || 'Someone';

    // Create notification for invitee
    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
       VALUES (gen_random_uuid(), $1, 'SESSION_SCHEDULED', $2, $3, $4, NOW())`,
      [inviteeId, "Session Invitation", 
       `${inviterName} invited you to join a session: ${session.Title}`,
       JSON.stringify({ sessionId, inviteId: newInvite.InviteID, expiresAt })]
    );

    return res.status(201).json({
      success: true,
      data: {
        ...newInvite,
        inviteeName: invitee.FullName,
        inviterName: inviterName,
      },
      message: `Invitation sent to ${invitee.FullName}`,
    });
  } catch (error) {
    console.error("[SessionInvite] Send invite error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to send invitation: " + (error as Error).message)],
    });
  }
});

// Get invites for a session
export const getSessionInvites = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;
    const page = getQueryNumber(req.query.page, 1);
    const limit = getQueryNumber(req.query.limit, 20);
    const offset = (page - 1) * limit;
    const status = getQueryString(req.query.status);

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
      SELECT i.*, 
             inviter."FullName" as "inviterName",
             inviter."ProfileImageURL" as "inviterImage",
             invitee."FullName" as "inviteeName",
             invitee."ProfileImageURL" as "inviteeImage",
             invitee."Email" as "inviteeEmail"
      FROM "SessionInvite" i
      JOIN "User" inviter ON i."InviterID" = inviter."UserID"
      JOIN "User" invitee ON i."InviteeID" = invitee."UserID"
      WHERE i."SessionID" = $1
    `;
    const params: any[] = [sessionId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      queryText += ` AND i."Status" = $${paramCount}`;
      params.push(status);
    }

    queryText += ` ORDER BY i."CreatedAt" DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM "SessionInvite" WHERE "SessionID" = $1`;
    if (status) {
      countQuery += ` AND "Status" = $2`;
      const countResult = await query(countQuery, [sessionId, status]);
      const total = parseInt(countResult.rows[0].count);
      return res.status(200).json({
        success: true,
        data: {
          invites: result.rows,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      });
    } else {
      const countResult = await query(countQuery, [sessionId]);
      const total = parseInt(countResult.rows[0].count);
      return res.status(200).json({
        success: true,
        data: {
          invites: result.rows,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      });
    }
  } catch (error) {
    console.error("[SessionInvite] Get session invites error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch invites")],
    });
  }
});

// Get my invites (invites received)
export const getMyInvites = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const page = getQueryNumber(req.query.page, 1);
    const limit = getQueryNumber(req.query.limit, 20);
    const offset = (page - 1) * limit;
    const status = getQueryString(req.query.status);

    let queryText = `
      SELECT i.*, 
             inviter."FullName" as "inviterName",
             inviter."ProfileImageURL" as "inviterImage",
             s."Title" as "sessionTitle",
             s."ScheduledStart" as "sessionStart",
             s."ScheduledEnd" as "sessionEnd",
             s."MeetingLink" as "meetingLink"
      FROM "SessionInvite" i
      JOIN "User" inviter ON i."InviterID" = inviter."UserID"
      JOIN "Session" s ON i."SessionID" = s."SessionID"
      WHERE i."InviteeID" = $1
    `;
    const params: any[] = [userId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      queryText += ` AND i."Status" = $${paramCount}`;
      params.push(status);
    }

    // Mark expired invites
    await query(
      `UPDATE "SessionInvite" 
       SET "Status" = 'EXPIRED' 
       WHERE "InviteeID" = $1 AND "Status" = 'PENDING' AND "ExpiresAt" < NOW()`,
      [userId]
    );

    queryText += ` ORDER BY i."CreatedAt" DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM "SessionInvite" WHERE "InviteeID" = $1`;
    if (status) {
      countQuery += ` AND "Status" = $2`;
      const countResult = await query(countQuery, [userId, status]);
      const total = parseInt(countResult.rows[0].count);
      return res.status(200).json({
        success: true,
        data: {
          invites: result.rows,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      });
    } else {
      const countResult = await query(countQuery, [userId]);
      const total = parseInt(countResult.rows[0].count);
      return res.status(200).json({
        success: true,
        data: {
          invites: result.rows,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      });
    }
  } catch (error) {
    console.error("[SessionInvite] Get my invites error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch invites")],
    });
  }
});

// Get invites I sent
export const getInvitesSent = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const page = getQueryNumber(req.query.page, 1);
    const limit = getQueryNumber(req.query.limit, 20);
    const offset = (page - 1) * limit;
    const status = getQueryString(req.query.status);

    let queryText = `
      SELECT i.*, 
             invitee."FullName" as "inviteeName",
             invitee."ProfileImageURL" as "inviteeImage",
             s."Title" as "sessionTitle"
      FROM "SessionInvite" i
      JOIN "User" invitee ON i."InviteeID" = invitee."UserID"
      JOIN "Session" s ON i."SessionID" = s."SessionID"
      WHERE i."InviterID" = $1
    `;
    const params: any[] = [userId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      queryText += ` AND i."Status" = $${paramCount}`;
      params.push(status);
    }

    queryText += ` ORDER BY i."CreatedAt" DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM "SessionInvite" WHERE "InviterID" = $1`;
    if (status) {
      countQuery += ` AND "Status" = $2`;
      const countResult = await query(countQuery, [userId, status]);
      const total = parseInt(countResult.rows[0].count);
      return res.status(200).json({
        success: true,
        data: {
          invites: result.rows,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      });
    } else {
      const countResult = await query(countQuery, [userId]);
      const total = parseInt(countResult.rows[0].count);
      return res.status(200).json({
        success: true,
        data: {
          invites: result.rows,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      });
    }
  } catch (error) {
    console.error("[SessionInvite] Get invites sent error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch sent invites")],
    });
  }
});

// Accept an invite
export const acceptInvite = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { inviteId } = req.params;

    // Check if invite exists and belongs to user
    const inviteCheck = await query(
      `SELECT i.*, s."SessionID", s."MentorID", s."LearnerID", s."Status" as "sessionStatus"
       FROM "SessionInvite" i
       JOIN "Session" s ON i."SessionID" = s."SessionID"
       WHERE i."InviteID" = $1 AND i."InviteeID" = $2`,
      [inviteId, userId]
    );

    if (inviteCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("invite", "Invite not found")],
      });
    }

    const invite = inviteCheck.rows[0];

    // Check if invite is still pending
    if (invite.Status !== InviteStatus.PENDING) {
      return res.status(400).json({
        success: false,
        errors: [formatError("invite", `Invite is already ${invite.Status.toLowerCase()}`)],
      });
    }

    // Check if invite is expired
    if (new Date(invite.ExpiresAt) < new Date()) {
      await query(
        `UPDATE "SessionInvite" SET "Status" = 'EXPIRED' WHERE "InviteID" = $1`,
        [inviteId]
      );
      return res.status(400).json({
        success: false,
        errors: [formatError("invite", "Invite has expired")],
      });
    }

    // Check if session is still active
    if (invite.sessionStatus === SessionStatus.COMPLETED || 
        invite.sessionStatus === SessionStatus.CANCELLED) {
      return res.status(400).json({
        success: false,
        errors: [formatError("session", "Session is no longer active")],
      });
    }

    // Update invite status
    await query(
      `UPDATE "SessionInvite" 
       SET "Status" = 'ACCEPTED', "RespondedAt" = NOW()
       WHERE "InviteID" = $1`,
      [inviteId]
    );

    // Add user as participant
    await query(
      `INSERT INTO "SessionParticipant" 
       ("ParticipantID", "SessionID", "UserID", "Role", "JoinedAt")
       VALUES (gen_random_uuid(), $1, $2, 'invited', NOW())`,
      [invite.SessionID, userId]
    );

    // Get session details
    const sessionResult = await query(
      `SELECT * FROM "Session" WHERE "SessionID" = $1`,
      [invite.SessionID]
    );
    const session = sessionResult.rows[0];

    // Notify inviter
    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
       VALUES (gen_random_uuid(), $1, 'SESSION_SCHEDULED', $2, $3, $4, NOW())`,
      [invite.InviterID, "Invite Accepted", 
       `${(req as any).user?.fullName} accepted your invitation to join ${session.Title}`,
       JSON.stringify({ sessionId: invite.SessionID, inviteId })]
    );

    return res.status(200).json({
      success: true,
      data: {
        sessionId: invite.SessionID,
        sessionTitle: session.Title,
        meetingLink: session.MeetingLink,
        scheduledStart: session.ScheduledStart,
      },
      message: "Invite accepted successfully",
    });
  } catch (error) {
    console.error("[SessionInvite] Accept invite error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to accept invitation")],
    });
  }
});

// Decline an invite
export const declineInvite = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { inviteId } = req.params;

    // Check if invite exists and belongs to user
    const inviteCheck = await query(
      `SELECT i.*, s."Title" as "sessionTitle"
       FROM "SessionInvite" i
       JOIN "Session" s ON i."SessionID" = s."SessionID"
       WHERE i."InviteID" = $1 AND i."InviteeID" = $2`,
      [inviteId, userId]
    );

    if (inviteCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("invite", "Invite not found")],
      });
    }

    const invite = inviteCheck.rows[0];

    if (invite.Status !== InviteStatus.PENDING) {
      return res.status(400).json({
        success: false,
        errors: [formatError("invite", `Invite is already ${invite.Status.toLowerCase()}`)],
      });
    }

    // Update invite status
    await query(
      `UPDATE "SessionInvite" 
       SET "Status" = 'DECLINED', "RespondedAt" = NOW()
       WHERE "InviteID" = $1`,
      [inviteId]
    );

    // Notify inviter
    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
       VALUES (gen_random_uuid(), $1, 'SESSION_CANCELLED', $2, $3, $4, NOW())`,
      [invite.InviterID, "Invite Declined", 
       `${(req as any).user?.fullName} declined your invitation to join ${invite.sessionTitle}`,
       JSON.stringify({ inviteId })]
    );

    return res.status(200).json({
      success: true,
      message: "Invite declined",
    });
  } catch (error) {
    console.error("[SessionInvite] Decline invite error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to decline invitation")],
    });
  }
});

// Cancel an invite (by inviter)
export const cancelInvite = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { inviteId } = req.params;

    // Check if invite exists and belongs to inviter
    const inviteCheck = await query(
      `SELECT * FROM "SessionInvite" 
       WHERE "InviteID" = $1 AND "InviterID" = $2 AND "Status" = 'PENDING'`,
      [inviteId, userId]
    );

    if (inviteCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("invite", "Invite not found or cannot be cancelled")],
      });
    }

    // Update invite status
    await query(
      `UPDATE "SessionInvite" 
       SET "Status" = 'EXPIRED', "RespondedAt" = NOW()
       WHERE "InviteID" = $1`,
      [inviteId]
    );

    return res.status(200).json({
      success: true,
      message: "Invite cancelled successfully",
    });
  } catch (error) {
    console.error("[SessionInvite] Cancel invite error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to cancel invitation")],
    });
  }
});

// Get invite statistics
export const getInviteStats = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;

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

    const result = await query(
      `SELECT 
         COUNT(*) as total_invites,
         COUNT(CASE WHEN "Status" = 'PENDING' THEN 1 END) as pending,
         COUNT(CASE WHEN "Status" = 'ACCEPTED' THEN 1 END) as accepted,
         COUNT(CASE WHEN "Status" = 'DECLINED' THEN 1 END) as declined,
         COUNT(CASE WHEN "Status" = 'EXPIRED' THEN 1 END) as expired
       FROM "SessionInvite"
       WHERE "SessionID" = $1`,
      [sessionId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("[SessionInvite] Get stats error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch invite statistics")],
    });
  }
});