// src/controllers/learner.controller.ts
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

// ==================== LEARNER SKILL MANAGEMENT ====================

// Add skill that learner wants to learn
export const addLearnerSkill = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { skillId, experienceLevel } = req.body;

    if (!skillId) {
      return res.status(400).json({
        success: false,
        errors: [formatError("skillId", "Skill ID is required")],
      });
    }

    // Check if user is learner
    const userResult = await query(
      `SELECT "Role" FROM "User" WHERE "UserID" = $1`,
      [userId]
    );

    if (userResult.rows[0]?.Role !== Role.Learner && userResult.rows[0]?.Role !== Role.Admin) {
      return res.status(403).json({
        success: false,
        errors: [formatError("role", "Only learners can add learning skills")],
      });
    }

    // Check if skill exists
    const skillCheck = await query(
      `SELECT * FROM "Skill" WHERE "SkillID" = $1 AND "IsAvailable" = true`,
      [skillId]
    );

    if (skillCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("skill", "Skill not found or not available")],
      });
    }

    // Check if already exists
    const existing = await query(
      `SELECT * FROM "UserSkill" WHERE "UserID" = $1 AND "SkillID" = $2`,
      [userId, skillId]
    );

    if (existing.rows.length > 0) {
      // Update existing
      const result = await query(
        `UPDATE "UserSkill" 
         SET "IsLearner" = true, 
             "ExperienceLevel" = COALESCE($3, "ExperienceLevel"),
             "UpdatedAt" = NOW()
         WHERE "UserID" = $1 AND "SkillID" = $2
         RETURNING *`,
        [userId, skillId, experienceLevel]
      );
      return res.status(200).json({
        success: true,
        data: result.rows[0],
        message: "Learning skill updated",
      });
    }

    // Insert new
    const result = await query(
      `INSERT INTO "UserSkill" 
       ("UserSkillID", "UserID", "SkillID", "IsLearner", "IsMentor", "ExperienceLevel", "CreatedAt", "UpdatedAt")
       VALUES (gen_random_uuid(), $1, $2, true, false, $3, NOW(), NOW())
       RETURNING *`,
      [userId, skillId, experienceLevel || null]
    );

    return res.status(201).json({
      success: true,
      data: result.rows[0],
      message: "Learning skill added successfully",
    });
  } catch (error) {
    console.error("Add learner skill error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Internal server error: " + (error as Error).message)],
    });
  }
});

// Get learner's learning skills
export const getMyLearningSkills = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;

    const result = await query(
      `SELECT s.*, us."ExperienceLevel", us."CreatedAt" as "AddedAt", 
              sc."Name" as "CategoryName", sc."SkillCategoryID" as "CategoryId"
       FROM "Skill" s
       JOIN "UserSkill" us ON s."SkillID" = us."SkillID"
       LEFT JOIN "SkillCategory" sc ON s."SkillCategoryID" = sc."SkillCategoryID"
       WHERE us."UserID" = $1 AND us."IsLearner" = true
       ORDER BY sc."DisplayOrder", s."Name"`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Get my learning skills error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch learning skills")],
    });
  }
});

// Remove learner skill
export const removeLearnerSkill = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { skillId } = req.params;

    await query(
      `UPDATE "UserSkill" 
       SET "IsLearner" = false, "UpdatedAt" = NOW()
       WHERE "UserID" = $1 AND "SkillID" = $2`,
      [userId, skillId]
    );

    return res.status(200).json({
      success: true,
      message: "Learning skill removed successfully",
    });
  } catch (error) {
    console.error("Remove learner skill error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to remove learning skill")],
    });
  }
});

// ==================== SKILL-BASED MENTOR MATCHING ====================

// Get matched mentors based on learner's skills
export const getMatchedMentors = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const page = getQueryNumber(req.query.page, 1);
    const limit = getQueryNumber(req.query.limit, 10);
    const offset = (page - 1) * limit;
    const skillId = getQueryString(req.query.skillId);
    const minMatchPercentage = getQueryNumber(req.query.minMatchPercentage, 0);
    const sortBy = getQueryString(req.query.sortBy) || "match"; // match, rating, experience

    // Get learner's skills
    const learnerSkills = await query(
      `SELECT "SkillID" FROM "UserSkill" 
       WHERE "UserID" = $1 AND "IsLearner" = true`,
      [userId]
    );

    if (learnerSkills.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          mentors: [],
          message: "Please add skills you want to learn first",
          pagination: { page, limit, total: 0, pages: 0 }
        },
      });
    }

    const learnerSkillIds = learnerSkills.rows.map(s => s.SkillID);

    // Build query to find mentors who teach learner's skills
    let queryText = `
      WITH mentor_skills AS (
        SELECT 
          u."UserID",
          u."FullName",
          u."Bio",
          u."ProfileImageURL",
          u."CreatedAt",
          u."IsOnline",
          COALESCE(AVG(r."Rating"), 0) as "avgRating",
          COUNT(DISTINCT r."ReviewID") as "totalReviews",
          COUNT(DISTINCT us."SkillID") as "totalSkills",
          array_agg(DISTINCT us."SkillID") as "skillIds",
          array_agg(DISTINCT s."Name") as "skillNames"
        FROM "User" u
        JOIN "UserSkill" us ON u."UserID" = us."UserID" AND us."IsMentor" = true
        JOIN "Skill" s ON us."SkillID" = s."SkillID" AND s."IsAvailable" = true
        LEFT JOIN "Review" r ON u."UserID" = r."RevieweeID" AND r."IsMentorReview" = true
        WHERE u."Role" = 'Mentor' AND u."Status" = 'Active'
        GROUP BY u."UserID"
      )
      SELECT 
        ms.*,
        (
          SELECT COUNT(*) 
          FROM unnest(ms."skillIds") AS skill_id 
          WHERE skill_id = ANY($1::text[])
        ) as "matchedSkillsCount",
        ROUND(
          (SELECT COUNT(*) 
           FROM unnest(ms."skillIds") AS skill_id 
           WHERE skill_id = ANY($1::text[]))::numeric / NULLIF(array_length(ms."skillIds", 1), 0) * 100, 
          2
        ) as "matchPercentage"
      FROM mentor_skills ms
      WHERE (SELECT COUNT(*) 
             FROM unnest(ms."skillIds") AS skill_id 
             WHERE skill_id = ANY($1::text[])) > 0
    `;

    const params: any[] = [learnerSkillIds];
    let paramCount = 1;

    if (skillId) {
      paramCount++;
      queryText += ` AND $${paramCount} = ANY(ms."skillIds")`;
      params.push(skillId);
    }

    if (minMatchPercentage > 0) {
      paramCount++;
      queryText += ` AND (SELECT COUNT(*) 
                          FROM unnest(ms."skillIds") AS skill_id 
                          WHERE skill_id = ANY($1::text[]))::numeric / NULLIF(array_length(ms."skillIds", 1), 0) * 100 >= $${paramCount}`;
      params.push(minMatchPercentage);
    }

    // Sorting
    if (sortBy === "rating") {
      queryText += ` ORDER BY ms."avgRating" DESC, "matchPercentage" DESC`;
    } else if (sortBy === "experience") {
      queryText += ` ORDER BY ms."CreatedAt" ASC`;
    } else {
      queryText += ` ORDER BY "matchPercentage" DESC, ms."avgRating" DESC, ms."totalSkills" DESC`;
    }

    queryText += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count for pagination
    const countResult = await query(
      `SELECT COUNT(DISTINCT u."UserID") FROM "User" u
       JOIN "UserSkill" us ON u."UserID" = us."UserID" AND us."IsMentor" = true
       WHERE u."Role" = 'Mentor' AND u."Status" = 'Active'
         AND us."SkillID" = ANY($1::text[])`,
      [learnerSkillIds]
    );
    const total = parseInt(countResult.rows[0].count);

    // Get detailed skills for each mentor
    const mentors = [];
    for (const mentor of result.rows) {
      const skills = await query(
        `SELECT s.*, us."ExperienceLevel", us."TeachingStyle",
                CASE WHEN $1::text[] IS NOT NULL AND s."SkillID" = ANY($1::text[]) 
                     THEN true ELSE false END as "isMatched"
         FROM "Skill" s
         JOIN "UserSkill" us ON s."SkillID" = us."SkillID"
         WHERE us."UserID" = $2 AND us."IsMentor" = true AND s."IsAvailable" = true
         ORDER BY "isMatched" DESC, s."Name"`,
        [learnerSkillIds, mentor.UserID]
      );
      mentors.push({ ...mentor, skills: skills.rows });
    }

    return res.status(200).json({
      success: true,
      data: {
        mentors,
        learnerSkills: learnerSkills.rows,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get matched mentors error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch matched mentors")],
    });
  }
});

// Get matched mentor details
export const getMatchedMentorDetails = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { mentorId } = req.params;

    // Get learner's skills
    const learnerSkills = await query(
      `SELECT "SkillID", "ExperienceLevel" FROM "UserSkill" 
       WHERE "UserID" = $1 AND "IsLearner" = true`,
      [userId]
    );
    const learnerSkillIds = learnerSkills.rows.map(s => s.SkillID);

    // Get mentor details with match info
    const mentorResult = await query(
      `SELECT u."UserID", u."FullName", u."Bio", u."ProfileImageURL", u."CreatedAt", u."IsOnline",
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

    // Get mentor's skills with match indication
    const skills = await query(
      `SELECT s.*, us."ExperienceLevel", us."TeachingStyle", us."CreatedAt" as "AddedAt",
              CASE WHEN $1::text[] IS NOT NULL AND s."SkillID" = ANY($1::text[]) 
                   THEN true ELSE false END as "isMatched"
       FROM "Skill" s
       JOIN "UserSkill" us ON s."SkillID" = us."SkillID"
       WHERE us."UserID" = $2 AND us."IsMentor" = true AND s."IsAvailable" = true
       ORDER BY "isMatched" DESC, s."Name"`,
      [learnerSkillIds, mentorId]
    );

    const matchedSkills = skills.rows.filter(s => s.isMatched);
    const matchPercentage = skills.rows.length > 0 
      ? Math.round((matchedSkills.length / skills.rows.length) * 100)
      : 0;

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

    // Get mentor's availability
    const availability = await query(
      `SELECT * FROM "Availability" 
       WHERE "UserID" = $1 AND "IsActive" = true
       ORDER BY "DayOfWeek", "StartTime"`,
      [mentorId]
    );

    return res.status(200).json({
      success: true,
      data: {
        ...mentor,
        skills: skills.rows,
        reviews: reviews.rows,
        availability: availability.rows,
        matchInfo: {
          matchedSkillsCount: matchedSkills.length,
          totalSkillsCount: skills.rows.length,
          matchPercentage,
          matchedSkills: matchedSkills.map(s => ({ 
            id: s.SkillID, 
            name: s.Name,
            mentorExperience: s.ExperienceLevel
          })),
        },
      },
    });
  } catch (error) {
    console.error("Get matched mentor details error:", error);
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
    const learnerName = (req as any).user?.fullName;
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

    // Check if learner wants to learn this skill
    const learnerSkillCheck = await query(
      `SELECT * FROM "UserSkill" 
       WHERE "UserID" = $1 AND "SkillID" = $2 AND "IsLearner" = true`,
      [learnerId, skillId]
    );

    if (learnerSkillCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        errors: [formatError("skill", "You haven't added this skill to your learning list")],
      });
    }

    // Create session
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
      [mentorId, "New Session Request", `${learnerName} wants to learn from you`,
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
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
       VALUES (gen_random_uuid(), $1, 'SESSION_CANCELLED', $2, $3, $4, NOW())`,
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

// Get recommended skills (based on popular skills)
export const getRecommendedSkills = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const limit = getQueryNumber(req.query.limit, 10);

    // Get learner's current skills
    const learnerSkills = await query(
      `SELECT "SkillID" FROM "UserSkill" WHERE "UserID" = $1 AND "IsLearner" = true`,
      [userId]
    );
    const learnerSkillIds = learnerSkills.rows.map(s => s.SkillID);

    let queryText = `
      SELECT s.*, sc."Name" as "CategoryName",
             COUNT(DISTINCT us."UserID") as "mentorCount",
             COUNT(DISTINCT ss."SessionID") as "sessionCount"
      FROM "Skill" s
      LEFT JOIN "SkillCategory" sc ON s."SkillCategoryID" = sc."SkillCategoryID"
      LEFT JOIN "UserSkill" us ON s."SkillID" = us."SkillID" AND us."IsMentor" = true
      LEFT JOIN "SessionSkill" ss ON s."SkillID" = ss."SkillID"
      WHERE s."IsAvailable" = true
    `;

    if (learnerSkillIds.length > 0) {
      queryText += ` AND s."SkillID" != ALL($1::text[])`;
      queryText += ` GROUP BY s."SkillID", sc."Name"
                     ORDER BY "mentorCount" DESC, "sessionCount" DESC
                     LIMIT $2`;
      const result = await query(queryText, [learnerSkillIds, limit]);
      return res.status(200).json({
        success: true,
        data: result.rows,
      });
    } else {
      queryText += ` GROUP BY s."SkillID", sc."Name"
                     ORDER BY "mentorCount" DESC, "sessionCount" DESC
                     LIMIT $1`;
      const result = await query(queryText, [limit]);
      return res.status(200).json({
        success: true,
        data: result.rows,
      });
    }
  } catch (error) {
    console.error("Get recommended skills error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch recommended skills")],
    });
  }
});