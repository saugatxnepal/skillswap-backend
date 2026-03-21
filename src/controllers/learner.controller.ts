import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";
import { RedisService } from "../utils/redis.util";
import { CacheKeys } from "../utils/cacheKeys.util";

enum Role {
  Admin = "Admin",
  Mentor = "Mentor",
  Learner = "Learner",
}

enum SessionStatus {
  PENDING_MATCH = "PENDING_MATCH",
  SCHEDULED = "SCHEDULED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  REPORTED = "REPORTED",
}

enum InviteStatus {
  PENDING = "PENDING",
  ACCEPTED = "ACCEPTED",
  DECLINED = "DECLINED",
  EXPIRED = "EXPIRED",
}

// Helper functions
const getQueryString = (param: any): string | undefined => {
  if (typeof param === 'string') return param;
  if (Array.isArray(param)) return param[0];
  return undefined;
};

const getQueryNumber = (param: any, defaultValue: number): number => {
  const str = getQueryString(param);
  if (!str) return defaultValue;
  const num = parseInt(str, 10);
  return isNaN(num) ? defaultValue : num;
};

// ==================== BROWSE MENTORS ====================

// Get all mentors with their skills and ratings
export const getAllMentors = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { 
      skillId, 
      categoryId, 
      search, 
      page = 1, 
      limit = 10,
      sortBy = "rating" // rating, experience, name
    } = req.query;
    
    const offset = (Number(page) - 1) * Number(limit);
    const params: any[] = [];
    let paramCount = 0;

    let queryText = `
      SELECT DISTINCT 
        u."UserID", u."FullName", u."Bio", u."ProfileImageURL", 
        u."CreatedAt",
        COALESCE(AVG(r."Rating"), 0) as "avgRating",
        COUNT(DISTINCT r."ReviewID") as "totalReviews",
        COUNT(DISTINCT s."SkillID") as "skillCount"
      FROM "User" u
      JOIN "UserSkill" us ON u."UserID" = us."UserID" AND us."IsMentor" = true
      JOIN "Skill" s ON us."SkillID" = s."SkillID" AND s."IsAvailable" = true
      LEFT JOIN "Review" r ON u."UserID" = r."RevieweeID" AND r."IsMentorReview" = true
      WHERE u."Role" = 'Mentor' AND u."Status" = 'Active'
    `;

    if (skillId) {
      paramCount++;
      queryText += ` AND s."SkillID" = $${paramCount}`;
      params.push(skillId);
    }

    if (categoryId) {
      paramCount++;
      queryText += ` AND s."SkillCategoryID" = $${paramCount}`;
      params.push(categoryId);
    }

    if (search) {
      paramCount++;
      queryText += ` AND (u."FullName" ILIKE $${paramCount} OR u."Bio" ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    queryText += ` GROUP BY u."UserID"`;

    // Sorting
    if (sortBy === "rating") {
      queryText += ` ORDER BY "avgRating" DESC, "skillCount" DESC`;
    } else if (sortBy === "experience") {
      queryText += ` ORDER BY u."CreatedAt" ASC`;
    } else {
      queryText += ` ORDER BY u."FullName" ASC`;
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT u."UserID") 
      FROM "User" u
      JOIN "UserSkill" us ON u."UserID" = us."UserID" AND us."IsMentor" = true
      JOIN "Skill" s ON us."SkillID" = s."SkillID" AND s."IsAvailable" = true
      WHERE u."Role" = 'Mentor' AND u."Status" = 'Active'
    `;
    const countResult = await query(countQuery, []);
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    queryText += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(Number(limit), offset);

    const result = await query(queryText, params);

    // Get skills for each mentor
    const mentors = [];
    for (const mentor of result.rows) {
      const skills = await query(
        `SELECT s.*, us."ExperienceLevel", us."TeachingStyle"
         FROM "Skill" s
         JOIN "UserSkill" us ON s."SkillID" = us."SkillID"
         WHERE us."UserID" = $1 AND us."IsMentor" = true AND s."IsAvailable" = true
         ORDER BY s."Name"`,
        [mentor.UserID]
      );
      mentors.push({ ...mentor, skills: skills.rows });
    }

    return res.status(200).json({
      success: true,
      data: {
        mentors,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get all mentors error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch mentors")],
    });
  }
});

// Get mentor details by ID
export const getMentorDetails = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { mentorId } = req.params;

    const mentorResult = await query(
      `SELECT u."UserID", u."FullName", u."Bio", u."ProfileImageURL", u."CreatedAt",
              COALESCE(AVG(r."Rating"), 0) as "avgRating",
              COUNT(DISTINCT r."ReviewID") as "totalReviews"
       FROM "User" u
       LEFT JOIN "Review" r ON u."UserID" = r."RevieweeID" AND r."IsMentorReview" = true
       WHERE u."UserID" = $1 AND u."Role" = 'Mentor' AND u."Status" = 'Active'
       GROUP BY u."UserID"`,
      [mentorId]
    );

    if (mentorResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("mentor", "Mentor not found")],
      });
    }

    const mentor = mentorResult.rows[0];

    // Get mentor's skills
    const skills = await query(
      `SELECT s.*, us."ExperienceLevel", us."TeachingStyle", us."CreatedAt" as "AddedAt"
       FROM "Skill" s
       JOIN "UserSkill" us ON s."SkillID" = us."SkillID"
       WHERE us."UserID" = $1 AND us."IsMentor" = true AND s."IsAvailable" = true
       ORDER BY s."Name"`,
      [mentorId]
    );

    // Get mentor's reviews
    const reviews = await query(
      `SELECT r.*, u."FullName" as "ReviewerName", u."ProfileImageURL" as "ReviewerImage"
       FROM "Review" r
       JOIN "User" u ON r."ReviewerID" = u."UserID"
       WHERE r."RevieweeID" = $1 AND r."IsMentorReview" = true
       ORDER BY r."CreatedAt" DESC
       LIMIT 20`,
      [mentorId]
    );

    return res.status(200).json({
      success: true,
      data: {
        ...mentor,
        skills: skills.rows,
        reviews: reviews.rows,
      },
    });
  } catch (error) {
    console.error("Get mentor details error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch mentor details")],
    });
  }
});

// ==================== SESSION MANAGEMENT FOR LEARNERS ====================

// Request a session with a mentor
export const requestSession = asyncHandler(async (req: Request, res: Response) => {
  try {
    const learnerId = (req as any).user?.UserID;
    const { mentorId, skillId, title, description, proposedTimeSlots } = req.body;

    if (!mentorId || !skillId || !title) {
      return res.status(400).json({
        success: false,
        errors: [formatError("fields", "Mentor, skill, and title are required")],
      });
    }

    // Check if mentor exists and is active
    const mentorCheck = await query(
      `SELECT * FROM "User" WHERE "UserID" = $1 AND "Role" = 'Mentor' AND "Status" = 'Active'`,
      [mentorId]
    );

    if (mentorCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("mentor", "Mentor not found or inactive")],
      });
    }

    // Check if skill belongs to mentor
    const skillCheck = await query(
      `SELECT * FROM "UserSkill" 
       WHERE "UserID" = $1 AND "SkillID" = $2 AND "IsMentor" = true`,
      [mentorId, skillId]
    );

    if (skillCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        errors: [formatError("skill", "Mentor does not teach this skill")],
      });
    }

    // Create session
    const sessionResult = await query(
      `INSERT INTO "Session" 
       ("SessionID", "Title", "Description", "LearnerID", "MentorID", "Status")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'PENDING_MATCH')
       RETURNING *`,
      [title, description || null, learnerId, mentorId]
    );

    const session = sessionResult.rows[0];

    // Link skill to session
    await query(
      `INSERT INTO "SessionSkill" ("SessionSkillID", "SessionID", "SkillID")
       VALUES (gen_random_uuid(), $1, $2)`,
      [session.SessionID, skillId]
    );

    // Create time slots if provided
    if (proposedTimeSlots && Array.isArray(proposedTimeSlots)) {
      for (const slot of proposedTimeSlots) {
        await query(
          `INSERT INTO "TimeSlot" 
           ("TimeSlotID", "SessionID", "UserID", "StartTime", "EndTime", "IsAvailable", "IsSelected")
           VALUES (gen_random_uuid(), $1, $2, $3, $4, true, false)`,
          [session.SessionID, learnerId, slot.startTime, slot.endTime]
        );
      }
    }

    // Create notification for mentor
    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data")
       VALUES (gen_random_uuid(), $1, 'MENTOR_REQUEST', $2, $3, $4)`,
      [mentorId, "New Session Request", `${(req as any).user?.FullName} wants to learn from you`, 
       JSON.stringify({ sessionId: session.SessionID, skillId })]
    );

    return res.status(201).json({
      success: true,
      data: session,
      message: "Session request sent to mentor",
    });
  } catch (error) {
    console.error("Request session error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to request session")],
    });
  }
});

// Get learner's sessions
export const getMySessions = asyncHandler(async (req: Request, res: Response) => {
  try {
    const learnerId = (req as any).user?.UserID;
    const { status, page = 1, limit = 10 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let queryText = `
      SELECT s.*, 
             m."FullName" as "MentorName",
             m."ProfileImageURL" as "MentorImage",
             m."Email" as "MentorEmail"
      FROM "Session" s
      JOIN "User" m ON s."MentorID" = m."UserID"
      WHERE s."LearnerID" = $1
    `;
    const params: any[] = [learnerId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      queryText += ` AND s."Status" = $${paramCount}`;
      params.push(status);
    }

    queryText += ` ORDER BY s."ScheduledStart" DESC NULLS LAST, s."CreatedAt" DESC
                   LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(Number(limit), offset);

    const result = await query(queryText, params);

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM "Session" WHERE "LearnerID" = $1${status ? ' AND "Status" = $2' : ''}`,
      status ? [learnerId, status] : [learnerId]
    );
    const total = parseInt(countResult.rows[0].count);

    // Get skills for each session
    const sessions = [];
    for (const session of result.rows) {
      const skills = await query(
        `SELECT s.* FROM "Skill" s
         JOIN "SessionSkill" ss ON s."SkillID" = ss."SkillID"
         WHERE ss."SessionID" = $1`,
        [session.SessionID]
      );
      sessions.push({ ...session, skills: skills.rows });
    }

    return res.status(200).json({
      success: true,
      data: {
        sessions,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get my sessions error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch sessions")],
    });
  }
});

// Cancel session (learner)
export const cancelSession = asyncHandler(async (req: Request, res: Response) => {
  try {
    const learnerId = (req as any).user?.UserID;
    const { sessionId } = req.params;

    const sessionCheck = await query(
      `SELECT * FROM "Session" WHERE "SessionID" = $1 AND "LearnerID" = $2`,
      [sessionId, learnerId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("session", "Session not found")],
      });
    }

    const session = sessionCheck.rows[0];

    if (session.Status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        errors: [formatError("session", "Cannot cancel completed session")],
      });
    }

    await query(
      `UPDATE "Session" 
       SET "Status" = 'CANCELLED', "UpdatedAt" = NOW()
       WHERE "SessionID" = $1`,
      [sessionId]
    );

    // Notify mentor
    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data")
       VALUES (gen_random_uuid(), $1, 'SESSION_CANCELLED', $2, $3, $4)`,
      [session.MentorID, "Session Cancelled", `Learner cancelled the session`, 
       JSON.stringify({ sessionId })]
    );

    return res.status(200).json({
      success: true,
      message: "Session cancelled successfully",
    });
  } catch (error) {
    console.error("Cancel session error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to cancel session")],
    });
  }
});