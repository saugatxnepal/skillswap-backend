import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";

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

    // Create session - FIXED: Added CreatedAt and UpdatedAt with NOW()
    const sessionResult = await query(
      `INSERT INTO "Session" 
       ("SessionID", "Title", "Description", "LearnerID", "MentorID", "Status", "CreatedAt", "UpdatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'PENDING_MATCH', NOW(), NOW())
       RETURNING *`,
      [title, description || null, learnerId, mentorId]
    );

    const session = sessionResult.rows[0];

    // Link skill to session
    await query(
      `INSERT INTO "SessionSkill" ("SessionSkillID", "SessionID", "SkillID", "CreatedAt")
       VALUES (gen_random_uuid(), $1, $2, NOW())`,
      [session.SessionID, skillId]
    );

    // Create time slots if provided
    if (proposedTimeSlots && Array.isArray(proposedTimeSlots)) {
      for (const slot of proposedTimeSlots) {
        await query(
          `INSERT INTO "TimeSlot" 
           ("TimeSlotID", "SessionID", "UserID", "StartTime", "EndTime", "IsAvailable", "IsSelected", "CreatedAt")
           VALUES (gen_random_uuid(), $1, $2, $3, $4, true, false, NOW())`,
          [session.SessionID, learnerId, slot.startTime, slot.endTime]
        );
      }
    }

    // Create notification for mentor
    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
       VALUES (gen_random_uuid(), $1, 'MENTOR_REQUEST', $2, $3, $4, NOW())`,
      [mentorId, "New Session Request", `${(req as any).user?.FullName} wants to learn from you`,
        JSON.stringify({ sessionId: session.SessionID, skillId })]
    );

    // Emit socket event for real-time update
    const io = req.app.get("io");
    if (io) {
      io.emit("session:new-request", {
        sessionId: session.SessionID,
        mentorId: mentorId,
        learnerName: (req as any).user?.FullName
      });
    }

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

    // Emit socket event for real-time update
    const io = req.app.get("io");
    if (io) {
      io.emit("session:cancelled", {
        sessionId: sessionId,
        by: 'learner'
      });
    }

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

// ==================== LEARNER STATS ====================

// Get learner self statistics dashboard
export const getLearnerStats = asyncHandler(async (req: Request, res: Response) => {
  try {
    const learnerId = (req as any).user?.UserID;

    // Check if user is a learner
    const userCheck = await query(
      `SELECT "Role" FROM "User" WHERE "UserID" = $1`,
      [learnerId]
    );

    if (userCheck.rows[0]?.Role !== Role.Learner && userCheck.rows[0]?.Role !== Role.Admin) {
      return res.status(403).json({
        success: false,
        errors: [formatError("role", "Only learners can access stats")],
      });
    }

    // 1. Session Statistics
    const sessionStats = await query(
      `SELECT 
        COUNT(*) FILTER (WHERE "Status" = 'PENDING_MATCH') as "pendingMatch",
        COUNT(*) FILTER (WHERE "Status" = 'SCHEDULED') as "scheduled",
        COUNT(*) FILTER (WHERE "Status" = 'IN_PROGRESS') as "inProgress",
        COUNT(*) FILTER (WHERE "Status" = 'COMPLETED') as "completed",
        COUNT(*) FILTER (WHERE "Status" = 'CANCELLED') as "cancelled",
        COUNT(*) FILTER (WHERE "Status" = 'REPORTED') as "reported",
        COUNT(*) as "total"
       FROM "Session" 
       WHERE "LearnerID" = $1`,
      [learnerId]
    );

    // 2. Session duration statistics (total learning hours)
    const durationStats = await query(
      `SELECT 
        SUM(EXTRACT(EPOCH FROM ("ActualEndTime" - "ActualStartTime")) / 3600) as "totalLearningHours",
        AVG(EXTRACT(EPOCH FROM ("ActualEndTime" - "ActualStartTime")) / 3600) as "averageSessionHours"
       FROM "Session" 
       WHERE "LearnerID" = $1 
         AND "Status" = 'COMPLETED'
         AND "ActualStartTime" IS NOT NULL 
         AND "ActualEndTime" IS NOT NULL`,
      [learnerId]
    );

    // 3. Mentor Statistics
    const mentorStats = await query(
      `SELECT 
        COUNT(DISTINCT "MentorID") as "totalMentors",
        COUNT(DISTINCT "MentorID") FILTER (WHERE "Status" = 'COMPLETED') as "completedWithMentors",
        COUNT(DISTINCT "MentorID") FILTER (WHERE "Status" = 'SCHEDULED') as "upcomingWithMentors"
       FROM "Session" 
       WHERE "LearnerID" = $1`,
      [learnerId]
    );

    // 4. Skill Statistics (what skills learner is learning)
    const skillStats = await query(
      `SELECT 
        COUNT(DISTINCT ss."SkillID") as "totalSkills",
        COUNT(DISTINCT ss."SkillID") FILTER (WHERE s."Status" = 'COMPLETED') as "completedSkills"
       FROM "Session" s
       JOIN "SessionSkill" ss ON s."SessionID" = ss."SessionID"
       WHERE s."LearnerID" = $1`,
      [learnerId]
    );

    // 5. Popular Skills (most requested by this learner)
    const popularSkills = await query(
      `SELECT 
        sk."SkillID",
        sk."Name",
        COUNT(DISTINCT s."SessionID") as "sessionCount",
        COUNT(DISTINCT s."MentorID") as "uniqueMentors",
        COUNT(*) FILTER (WHERE s."Status" = 'COMPLETED') as "completedCount"
       FROM "Skill" sk
       JOIN "SessionSkill" ss ON sk."SkillID" = ss."SkillID"
       JOIN "Session" s ON ss."SessionID" = s."SessionID"
       WHERE s."LearnerID" = $1
       GROUP BY sk."SkillID", sk."Name"
       ORDER BY "sessionCount" DESC
       LIMIT 5`,
      [learnerId]
    );

    // 6. Favorite Mentors (most sessions with)
    const favoriteMentors = await query(
      `SELECT 
        u."UserID",
        u."FullName",
        u."ProfileImageURL",
        COUNT(*) as "sessionCount",
        COUNT(*) FILTER (WHERE s."Status" = 'COMPLETED') as "completedCount",
        COALESCE(AVG(r."Rating"), 0) as "avgRating"
       FROM "Session" s
       JOIN "User" u ON s."MentorID" = u."UserID"
       LEFT JOIN "Review" r ON s."SessionID" = r."SessionID" AND r."ReviewerID" = $1
       WHERE s."LearnerID" = $1
       GROUP BY u."UserID", u."FullName", u."ProfileImageURL"
       ORDER BY "sessionCount" DESC
       LIMIT 5`,
      [learnerId]
    );

    // 7. Recent Performance (last 30 days)
    const recentPerformance = await query(
      `SELECT 
        DATE_TRUNC('day', "ScheduledStart") as "date",
        COUNT(*) as "sessionsCount",
        COUNT(*) FILTER (WHERE "Status" = 'COMPLETED') as "completedCount",
        COUNT(*) FILTER (WHERE "Status" = 'CANCELLED') as "cancelledCount"
       FROM "Session" 
       WHERE "LearnerID" = $1 
         AND "ScheduledStart" >= NOW() - INTERVAL '30 days'
       GROUP BY DATE_TRUNC('day', "ScheduledStart")
       ORDER BY "date" DESC
       LIMIT 30`,
      [learnerId]
    );

    // 8. Completion Rate
    const totalSessions = parseInt(sessionStats.rows[0].total);
    const completedSessions = parseInt(sessionStats.rows[0].completed);
    const cancelledSessions = parseInt(sessionStats.rows[0].cancelled);
    
    const completionRate = totalSessions > 0 
      ? ((completedSessions / (totalSessions - cancelledSessions)) * 100).toFixed(1)
      : '0';

    // 9. Reviews Given by Learner
    const reviewsGiven = await query(
      `SELECT 
        COUNT(*) as "totalReviews",
        COALESCE(AVG("Rating"), 0) as "averageRatingGiven",
        COUNT(*) FILTER (WHERE "Rating" = 5) as "fiveStar",
        COUNT(*) FILTER (WHERE "Rating" = 4) as "fourStar",
        COUNT(*) FILTER (WHERE "Rating" = 3) as "threeStar",
        COUNT(*) FILTER (WHERE "Rating" = 2) as "twoStar",
        COUNT(*) FILTER (WHERE "Rating" = 1) as "oneStar"
       FROM "Review" 
       WHERE "ReviewerID" = $1`,
      [learnerId]
    );

    // 10. Monthly Trends (last 6 months)
    const monthlyTrends = await query(
      `SELECT 
        DATE_TRUNC('month', "ScheduledStart") as "month",
        COUNT(*) as "totalSessions",
        COUNT(*) FILTER (WHERE "Status" = 'COMPLETED') as "completedSessions",
        COUNT(*) FILTER (WHERE "Status" = 'CANCELLED') as "cancelledSessions"
       FROM "Session" 
       WHERE "LearnerID" = $1 
         AND "ScheduledStart" >= NOW() - INTERVAL '6 months'
       GROUP BY DATE_TRUNC('month', "ScheduledStart")
       ORDER BY "month" DESC`,
      [learnerId]
    );

    // 11. Upcoming Sessions (next 7 days)
    const upcomingSessions = await query(
      `SELECT 
        s."SessionID",
        s."Title",
        s."ScheduledStart",
        s."ScheduledEnd",
        m."FullName" as "MentorName",
        m."ProfileImageURL" as "MentorImage",
        sk."Name" as "SkillName"
       FROM "Session" s
       JOIN "User" m ON s."MentorID" = m."UserID"
       JOIN "SessionSkill" ss ON s."SessionID" = ss."SessionID"
       JOIN "Skill" sk ON ss."SkillID" = sk."SkillID"
       WHERE s."LearnerID" = $1 
         AND s."Status" = 'SCHEDULED'
         AND s."ScheduledStart" >= NOW()
         AND s."ScheduledStart" <= NOW() + INTERVAL '7 days'
       ORDER BY s."ScheduledStart" ASC
       LIMIT 5`,
      [learnerId]
    );

    // 12. Recent Sessions (last 5 sessions)
    const recentSessions = await query(
      `SELECT 
        s."SessionID",
        s."Title",
        s."ScheduledStart",
        s."Status",
        m."FullName" as "MentorName",
        m."ProfileImageURL" as "MentorImage",
        sk."Name" as "SkillName"
       FROM "Session" s
       JOIN "User" m ON s."MentorID" = m."UserID"
       JOIN "SessionSkill" ss ON s."SessionID" = ss."SessionID"
       JOIN "Skill" sk ON ss."SkillID" = sk."SkillID"
       WHERE s."LearnerID" = $1
       ORDER BY s."ScheduledStart" DESC NULLS LAST, s."CreatedAt" DESC
       LIMIT 5`,
      [learnerId]
    );

    // Combine all stats
    return res.status(200).json({
      success: true,
      data: {
        overview: {
          totalSessions: parseInt(sessionStats.rows[0].total),
          completedSessions: parseInt(sessionStats.rows[0].completed),
          completionRate: parseFloat(completionRate),
          totalLearningHours: parseFloat(durationStats.rows[0]?.totalLearningHours || 0),
          averageSessionHours: parseFloat(durationStats.rows[0]?.averageSessionHours || 0),
          totalMentors: parseInt(mentorStats.rows[0].totalMentors),
          totalSkills: parseInt(skillStats.rows[0].totalSkills),
          totalReviewsGiven: parseInt(reviewsGiven.rows[0].totalReviews),
        },
        sessions: {
          pendingMatch: parseInt(sessionStats.rows[0].pendingMatch),
          scheduled: parseInt(sessionStats.rows[0].scheduled),
          inProgress: parseInt(sessionStats.rows[0].inProgress),
          completed: parseInt(sessionStats.rows[0].completed),
          cancelled: parseInt(sessionStats.rows[0].cancelled),
          reported: parseInt(sessionStats.rows[0].reported),
        },
        learning: {
          totalLearningHours: parseFloat(durationStats.rows[0]?.totalLearningHours || 0),
          averageSessionHours: parseFloat(durationStats.rows[0]?.averageSessionHours || 0),
          completedSessions: parseInt(sessionStats.rows[0].completed),
        },
        mentors: {
          totalMentors: parseInt(mentorStats.rows[0].totalMentors),
          completedWithMentors: parseInt(mentorStats.rows[0].completedWithMentors),
          upcomingWithMentors: parseInt(mentorStats.rows[0].upcomingWithMentors),
          favoriteMentors: favoriteMentors.rows,
        },
        skills: {
          totalSkills: parseInt(skillStats.rows[0].totalSkills),
          completedSkills: parseInt(skillStats.rows[0].completedSkills),
          popularSkills: popularSkills.rows,
        },
        reviews: {
          totalReviews: parseInt(reviewsGiven.rows[0].totalReviews),
          averageRatingGiven: parseFloat(reviewsGiven.rows[0].averageRatingGiven),
          distribution: {
            5: parseInt(reviewsGiven.rows[0].fiveStar),
            4: parseInt(reviewsGiven.rows[0].fourStar),
            3: parseInt(reviewsGiven.rows[0].threeStar),
            2: parseInt(reviewsGiven.rows[0].twoStar),
            1: parseInt(reviewsGiven.rows[0].oneStar),
          },
        },
        upcoming: {
          nextWeek: upcomingSessions.rows,
          count: upcomingSessions.rows.length,
        },
        recent: {
          sessions: recentSessions.rows,
        },
        trends: {
          recentPerformance: recentPerformance.rows,
          monthlyTrends: monthlyTrends.rows,
        },
      },
    });
  } catch (error) {
    console.error("Get learner stats error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch learner statistics: " + (error as Error).message)],
    });
  }
});