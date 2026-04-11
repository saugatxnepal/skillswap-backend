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

// ==================== SKILL CATEGORIES ====================

// Get all skill categories
export const getSkillCategories = asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM "SkillCategory" 
       ORDER BY "DisplayOrder", "Name"`
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Get skill categories error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch categories")],
    });
  }
});

// ==================== SKILL MANAGEMENT ====================

// Mentor adds a new skill
export const addMentorSkill = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { name, description, detailedContent, skillCategoryId, experienceLevel, teachingStyle } = req.body;

    if (!name || !skillCategoryId) {
      return res.status(400).json({
        success: false,
        errors: [formatError("fields", "Skill name and category are required")],
      });
    }

    const userResult = await query(
      `SELECT "Role" FROM "User" WHERE "UserID" = $1`,
      [userId]
    );

    if (userResult.rows[0]?.Role !== Role.Mentor && userResult.rows[0]?.Role !== Role.Admin) {
      return res.status(403).json({
        success: false,
        errors: [formatError("role", "Only mentors can add skills")],
      });
    }

    const categoryCheck = await query(
      `SELECT * FROM "SkillCategory" WHERE "SkillCategoryID" = $1`,
      [skillCategoryId]
    );

    if (categoryCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("category", "Skill category not found")],
      });
    }

    const existingSkill = await query(
      `SELECT s.* FROM "Skill" s
       JOIN "UserSkill" us ON s."SkillID" = us."SkillID"
       WHERE us."UserID" = $1 AND s."Name" ILIKE $2 AND us."IsMentor" = true`,
      [userId, name.trim()]
    );

    if (existingSkill.rows.length > 0) {
      return res.status(400).json({
        success: false,
        errors: [formatError("name", "You already have a skill with this name")],
      });
    }

    const skillResult = await query(
      `INSERT INTO "Skill" 
       ("SkillID", "Name", "Description", "DetailedContent", "SkillCategoryID", "IsAvailable")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
       RETURNING *`,
      [name.trim(), description || null, detailedContent || null, skillCategoryId]
    );

    const newSkill = skillResult.rows[0];

    const userSkillResult = await query(
      `INSERT INTO "UserSkill" 
       ("UserSkillID", "UserID", "SkillID", "IsMentor", "IsLearner", 
        "ExperienceLevel", "TeachingStyle", "CreatedAt", "UpdatedAt")
       VALUES (gen_random_uuid(), $1, $2, true, false, $3, $4, NOW(), NOW())
       RETURNING *`,
      [userId, newSkill.SkillID, experienceLevel || null, teachingStyle || null]
    );

    return res.status(201).json({
      success: true,
      data: {
        skill: newSkill,
        userSkill: userSkillResult.rows[0],
      },
      message: "Skill added successfully",
    });
  } catch (error) {
    console.error("Add mentor skill error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Internal server error: " + (error as Error).message)],
    });
  }
});

// Get mentor's skills
export const getMyMentorSkills = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;

    // Remove the IsAvailable filter completely to get ALL skills
    const queryText = `
      SELECT s.*, us."ExperienceLevel", us."TeachingStyle", 
             us."CreatedAt" as "AddedAt", sc."Name" as "CategoryName",
             sc."SkillCategoryID" as "CategoryId"
      FROM "Skill" s
      JOIN "UserSkill" us ON s."SkillID" = us."SkillID"
      LEFT JOIN "SkillCategory" sc ON s."SkillCategoryID" = sc."SkillCategoryID"
      WHERE us."UserID" = $1 AND us."IsMentor" = true
      ORDER BY sc."DisplayOrder", s."Name"
    `;

    const result = await query(queryText, [userId]);

    return res.status(200).json({
      success: true,
      data: result.rows,
      meta: {
        totalCount: result.rows.length,
        availableCount: result.rows.filter((row: any) => row.IsAvailable).length,
        unavailableCount: result.rows.filter((row: any) => !row.IsAvailable).length,
      }
    });
  } catch (error) {
    console.error("Get my mentor skills error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch skills")],
    });
  }
});

// Update mentor skill
export const updateMentorSkill = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { skillId } = req.params;
    const { name, description, detailedContent, experienceLevel, teachingStyle, isAvailable } = req.body;

    if (!skillId) {
      return res.status(400).json({
        success: false,
        errors: [formatError("skillId", "Skill ID is required")],
      });
    }

    const userSkill = await query(
      `SELECT * FROM "UserSkill" WHERE "UserID" = $1 AND "SkillID" = $2 AND "IsMentor" = true`,
      [userId, skillId]
    );

    if (userSkill.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("skill", "You don't mentor this skill")],
      });
    }

    // Update skill details (Skill table has NO UpdatedAt)
    if (name || description || detailedContent || isAvailable !== undefined) {
      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (name) {
        updates.push(`"Name" = $${paramCount++}`);
        values.push(name);
      }
      if (description !== undefined) {
        updates.push(`"Description" = $${paramCount++}`);
        values.push(description);
      }
      if (detailedContent !== undefined) {
        updates.push(`"DetailedContent" = $${paramCount++}`);
        values.push(detailedContent);
      }
      if (isAvailable !== undefined) {
        updates.push(`"IsAvailable" = $${paramCount++}`);
        values.push(isAvailable);
      }

      // REMOVED: `"UpdatedAt" = NOW()` - Skill table doesn't have this column
      values.push(skillId);
      await query(
        `UPDATE "Skill" 
         SET ${updates.join(', ')}
         WHERE "SkillID" = $${paramCount}`,
        values
      );
    }

    // Update user skill details (UserSkill table HAS UpdatedAt)
    if (experienceLevel !== undefined || teachingStyle !== undefined) {
      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (experienceLevel !== undefined) {
        updates.push(`"ExperienceLevel" = $${paramCount++}`);
        values.push(experienceLevel);
      }
      if (teachingStyle !== undefined) {
        updates.push(`"TeachingStyle" = $${paramCount++}`);
        values.push(teachingStyle);
      }

      updates.push(`"UpdatedAt" = NOW()`); // UserSkill has UpdatedAt
      values.push(userId, skillId);
      await query(
        `UPDATE "UserSkill" 
         SET ${updates.join(', ')}
         WHERE "UserID" = $${paramCount} AND "SkillID" = $${paramCount + 1}`,
        values
      );
    }

    return res.status(200).json({
      success: true,
      message: "Skill updated successfully",
    });
  } catch (error) {
    console.error("Update mentor skill error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to update skill")],
    });
  }
});

// Toggle skill availability
export const toggleSkillAvailability = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { skillId } = req.params;
    const { isAvailable } = req.body;

    if (!skillId) {
      return res.status(400).json({
        success: false,
        errors: [formatError("skillId", "Skill ID is required")],
      });
    }

    const userSkill = await query(
      `SELECT * FROM "UserSkill" WHERE "UserID" = $1 AND "SkillID" = $2 AND "IsMentor" = true`,
      [userId, skillId]
    );

    if (userSkill.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("skill", "You don't mentor this skill")],
      });
    }

    // REMOVED: "UpdatedAt" = NOW() - Skill table doesn't have this column
    const result = await query(
      `UPDATE "Skill" 
       SET "IsAvailable" = $1
       WHERE "SkillID" = $2
       RETURNING *`,
      [isAvailable, skillId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows[0],
      message: isAvailable ? "Skill is now available" : "Skill is now unavailable",
    });
  } catch (error) {
    console.error("Toggle skill availability error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to toggle skill availability")],
    });
  }
});

// Delete mentor skill
export const deleteMentorSkill = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { skillId } = req.params;

    const activeSessions = await query(
      `SELECT COUNT(*) FROM "Session" s
       JOIN "SessionSkill" ss ON s."SessionID" = ss."SessionID"
       WHERE s."MentorID" = $1 
         AND ss."SkillID" = $2 
         AND s."Status" NOT IN ('COMPLETED', 'CANCELLED')`,
      [userId, skillId]
    );

    if (parseInt(activeSessions.rows[0].count) > 0) {
      return res.status(400).json({
        success: false,
        errors: [formatError("skill", "Cannot delete skill with active sessions")],
      });
    }

    await query(
      `DELETE FROM "UserSkill" 
       WHERE "UserID" = $1 AND "SkillID" = $2 AND "IsMentor" = true`,
      [userId, skillId]
    );

    await query(
      `DELETE FROM "Skill" WHERE "SkillID" = $1`,
      [skillId]
    );

    return res.status(200).json({
      success: true,
      message: "Skill deleted successfully",
    });
  } catch (error) {
    console.error("Delete mentor skill error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to delete skill")],
    });
  }
});

// ==================== AVAILABILITY MANAGEMENT ====================

// Set weekly availability
export const setWeeklyAvailability = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { availability } = req.body;

    if (!availability || !Array.isArray(availability)) {
      return res.status(400).json({
        success: false,
        errors: [formatError("availability", "Availability array is required")],
      });
    }

    // Delete existing recurring availability for this user
    await query(
      `DELETE FROM "Availability" WHERE "UserID" = $1 AND "IsRecurring" = true`,
      [userId]
    );

    // Insert new availability
    const inserted = [];
    for (const slot of availability) {
      const { dayOfWeek, startTime, endTime } = slot;

      if (dayOfWeek === undefined || !startTime || !endTime) {
        continue;
      }

      // FIXED: Added CreatedAt and UpdatedAt with NOW()
      const result = await query(
        `INSERT INTO "Availability" 
         ("AvailabilityID", "UserID", "DayOfWeek", "StartTime", "EndTime", 
          "IsRecurring", "IsActive", "CreatedAt", "UpdatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, true, true, NOW(), NOW())
         RETURNING *`,
        [userId, dayOfWeek, startTime, endTime]
      );
      inserted.push(result.rows[0]);
    }

    return res.status(200).json({
      success: true,
      data: inserted,
      message: "Weekly availability set successfully",
    });
  } catch (error) {
    console.error("Set weekly availability error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to set availability")],
    });
  }
});

// Get mentor's availability (for learners)
export const getMentorAvailability = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { mentorId } = req.params;

    if (!mentorId) {
      return res.status(400).json({
        success: false,
        errors: [formatError("mentorId", "Mentor ID is required")],
      });
    }

    const weeklyResult = await query(
      `SELECT * FROM "Availability" 
       WHERE "UserID" = $1 AND "IsRecurring" = true AND "IsActive" = true
       ORDER BY "DayOfWeek", "StartTime"`,
      [mentorId]
    );

    const specificResult = await query(
      `SELECT * FROM "Availability" 
       WHERE "UserID" = $1 AND "IsRecurring" = false AND "IsActive" = true
         AND "SpecificDate" >= NOW()
       ORDER BY "SpecificDate", "StartTime"`,
      [mentorId]
    );

    return res.status(200).json({
      success: true,
      data: {
        weekly: weeklyResult.rows,
        specific: specificResult.rows,
      },
    });
  } catch (error) {
    console.error("Get mentor availability error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch availability")],
    });
  }
});

// Get my availability (authenticated mentor)
export const getMyAvailability = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;

    const weeklyResult = await query(
      `SELECT * FROM "Availability" 
       WHERE "UserID" = $1 AND "IsRecurring" = true AND "IsActive" = true
       ORDER BY "DayOfWeek", "StartTime"`,
      [userId]
    );

    const specificResult = await query(
      `SELECT * FROM "Availability" 
       WHERE "UserID" = $1 AND "IsRecurring" = false AND "IsActive" = true
         AND "SpecificDate" >= NOW()
       ORDER BY "SpecificDate", "StartTime"`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      data: {
        weekly: weeklyResult.rows,
        specific: specificResult.rows,
      },
    });
  } catch (error) {
    console.error("Get my availability error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch availability")],
    });
  }
});

// Add specific date availability
export const addSpecificAvailability = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { specificDate, startTime, endTime } = req.body;

    if (!specificDate || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        errors: [formatError("fields", "Specific date, start time and end time are required")],
      });
    }

    // FIXED: Added CreatedAt and UpdatedAt with NOW()
    const result = await query(
      `INSERT INTO "Availability" 
       ("AvailabilityID", "UserID", "DayOfWeek", "StartTime", "EndTime", 
        "IsRecurring", "SpecificDate", "IsActive", "CreatedAt", "UpdatedAt")
       VALUES (gen_random_uuid(), $1, EXTRACT(DOW FROM $2::date), $3, $4, 
               false, $2, true, NOW(), NOW())
       RETURNING *`,
      [userId, specificDate, startTime, endTime]
    );

    return res.status(201).json({
      success: true,
      data: result.rows[0],
      message: "Specific availability added",
    });
  } catch (error) {
    console.error("Add specific availability error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to add availability")],
    });
  }
});

// Remove availability slot
export const removeAvailability = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { availabilityId } = req.params;

    if (!availabilityId) {
      return res.status(400).json({
        success: false,
        errors: [formatError("availabilityId", "Availability ID is required")],
      });
    }

    await query(
      `DELETE FROM "Availability" WHERE "AvailabilityID" = $1 AND "UserID" = $2`,
      [availabilityId, userId]
    );

    return res.status(200).json({
      success: true,
      message: "Availability removed successfully",
    });
  } catch (error) {
    console.error("Remove availability error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to remove availability")],
    });
  }
});

// ==================== SESSION MANAGEMENT ====================

// Get mentor's sessions
export const getMentorSessions = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { status, page = 1, limit = 10 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let queryText = `
      SELECT s.*, 
             u."FullName" as "LearnerName",
             u."ProfileImageURL" as "LearnerImage",
             u."Email" as "LearnerEmail",
             sk."Name" as "SkillName"
      FROM "Session" s
      JOIN "User" u ON s."LearnerID" = u."UserID"
      LEFT JOIN "SessionSkill" ss ON s."SessionID" = ss."SessionID"
      LEFT JOIN "Skill" sk ON ss."SkillID" = sk."SkillID"
      WHERE s."MentorID" = $1
    `;
    const params: any[] = [userId];
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

    const countResult = await query(
      `SELECT COUNT(*) FROM "Session" WHERE "MentorID" = $1${status ? ' AND "Status" = $2' : ''}`,
      status ? [userId, status] : [userId]
    );
    const total = parseInt(countResult.rows[0].count);

    return res.status(200).json({
      success: true,
      data: {
        sessions: result.rows,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get mentor sessions error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch sessions")],
    });
  }
});

// Get session details
export const getSessionDetails = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;

    const result = await query(
      `SELECT s.*,
              l."FullName" as "LearnerName",
              l."Email" as "LearnerEmail",
              l."ProfileImageURL" as "LearnerImage",
              m."FullName" as "MentorName",
              m."Email" as "MentorEmail",
              m."ProfileImageURL" as "MentorImage"
       FROM "Session" s
       JOIN "User" l ON s."LearnerID" = l."UserID"
       JOIN "User" m ON s."MentorID" = m."UserID"
       WHERE s."SessionID" = $1 AND (s."MentorID" = $2 OR s."LearnerID" = $2)`,
      [sessionId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("session", "Session not found")],
      });
    }

    const skills = await query(
      `SELECT s.* FROM "Skill" s
       JOIN "SessionSkill" ss ON s."SkillID" = ss."SkillID"
       WHERE ss."SessionID" = $1`,
      [sessionId]
    );

    const participants = await query(
      `SELECT p.*, u."FullName", u."Email", u."ProfileImageURL"
       FROM "SessionParticipant" p
       JOIN "User" u ON p."UserID" = u."UserID"
       WHERE p."SessionID" = $1`,
      [sessionId]
    );

    return res.status(200).json({
      success: true,
      data: {
        ...result.rows[0],
        skills: skills.rows,
        participants: participants.rows,
      },
    });
  } catch (error) {
    console.error("Get session details error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch session details")],
    });
  }
});

// Update session status
export const updateSessionStatus = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;
    const { status, meetingLink } = req.body;

    const sessionCheck = await query(
      `SELECT * FROM "Session" WHERE "SessionID" = $1 AND "MentorID" = $2`,
      [sessionId, userId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "You are not the mentor of this session")],
      });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (status) {
      updates.push(`"Status" = $${paramCount++}`);
      values.push(status);
    }

    if (meetingLink) {
      updates.push(`"MeetingLink" = $${paramCount++}`);
      values.push(meetingLink);
    }

    if (status === 'IN_PROGRESS') {
      updates.push(`"ActualStartTime" = NOW()`);
    }

    if (status === 'COMPLETED') {
      updates.push(`"ActualEndTime" = NOW()`);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        errors: [formatError("fields", "No fields to update")],
      });
    }

    values.push(sessionId);
    const result = await query(
      `UPDATE "Session" 
       SET ${updates.join(', ')}, "UpdatedAt" = NOW()
       WHERE "SessionID" = $${paramCount}
       RETURNING *`,
      values
    );

    return res.status(200).json({
      success: true,
      data: result.rows[0],
      message: "Session status updated",
    });
  } catch (error) {
    console.error("Update session status error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to update session status")],
    });
  }
});

// Get mentor statistics dashboard
export const getMentorStats = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;

    // Check if user is a mentor
    const userCheck = await query(
      `SELECT "Role" FROM "User" WHERE "UserID" = $1`,
      [userId]
    );

    if (userCheck.rows[0]?.Role !== Role.Mentor && userCheck.rows[0]?.Role !== Role.Admin) {
      return res.status(403).json({
        success: false,
        errors: [formatError("role", "Only mentors can access stats")],
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
       WHERE "MentorID" = $1`,
      [userId]
    );

    // 2. Session duration statistics
    const durationStats = await query(
      `SELECT 
        AVG(EXTRACT(EPOCH FROM ("ActualEndTime" - "ActualStartTime")) / 3600) as "averageSessionHours",
        SUM(EXTRACT(EPOCH FROM ("ActualEndTime" - "ActualStartTime")) / 3600) as "totalTeachingHours"
       FROM "Session" 
       WHERE "MentorID" = $1 
         AND "Status" = 'COMPLETED'
         AND "ActualStartTime" IS NOT NULL 
         AND "ActualEndTime" IS NOT NULL`,
      [userId]
    );

    // 3. Skill Statistics
    const skillStats = await query(
      `SELECT 
        COUNT(DISTINCT s."SkillID") as "totalSkills",
        COUNT(DISTINCT s."SkillID") FILTER (WHERE s."IsAvailable" = true) as "availableSkills",
        COUNT(DISTINCT s."SkillID") FILTER (WHERE s."IsAvailable" = false) as "unavailableSkills"
       FROM "UserSkill" us
       JOIN "Skill" s ON us."SkillID" = s."SkillID"
       WHERE us."UserID" = $1 AND us."IsMentor" = true`,
      [userId]
    );

    // 4. Popular Skills (most requested/booked)
    const popularSkills = await query(
      `SELECT 
        s."SkillID",
        s."Name",
        s."IsAvailable",
        COUNT(DISTINCT ss."SessionID") as "sessionCount",
        COUNT(DISTINCT ses."LearnerID") as "uniqueLearners"
       FROM "Skill" s
       JOIN "UserSkill" us ON s."SkillID" = us."SkillID"
       LEFT JOIN "SessionSkill" ss ON s."SkillID" = ss."SkillID"
       LEFT JOIN "Session" ses ON ss."SessionID" = ses."SessionID" AND ses."MentorID" = us."UserID"
       WHERE us."UserID" = $1 AND us."IsMentor" = true
       GROUP BY s."SkillID", s."Name", s."IsAvailable"
       ORDER BY "sessionCount" DESC
       LIMIT 5`,
      [userId]
    );

    // 5. Availability Statistics
    const availabilityStats = await query(
      `SELECT 
        COUNT(*) FILTER (WHERE "IsRecurring" = true AND "IsActive" = true) as "weeklySlots",
        COUNT(*) FILTER (WHERE "IsRecurring" = false AND "IsActive" = true AND "SpecificDate" >= NOW()) as "upcomingSpecificSlots",
        COUNT(*) FILTER (WHERE "IsActive" = true) as "totalActiveSlots"
       FROM "Availability" 
       WHERE "UserID" = $1`,
      [userId]
    );

    // 6. Learner Statistics
    const learnerStats = await query(
      `SELECT 
        COUNT(DISTINCT "LearnerID") as "totalUniqueLearners",
        COUNT(DISTINCT "LearnerID") FILTER (WHERE "Status" = 'COMPLETED') as "completedWithLearners",
        COUNT(DISTINCT "LearnerID") FILTER (WHERE "Status" = 'SCHEDULED') as "upcomingWithLearners"
       FROM "Session" 
       WHERE "MentorID" = $1`,
      [userId]
    );

    // 7. Recent Performance (last 30 days)
    const recentPerformance = await query(
      `SELECT 
        DATE_TRUNC('day', "ScheduledStart") as "date",
        COUNT(*) as "sessionsCount",
        COUNT(*) FILTER (WHERE "Status" = 'COMPLETED') as "completedCount"
       FROM "Session" 
       WHERE "MentorID" = $1 
         AND "ScheduledStart" >= NOW() - INTERVAL '30 days'
       GROUP BY DATE_TRUNC('day', "ScheduledStart")
       ORDER BY "date" DESC
       LIMIT 30`,
      [userId]
    );

    // 8. Completion Rate
    const totalSessions = parseInt(sessionStats.rows[0].total);
    const completedSessions = parseInt(sessionStats.rows[0].completed);
    const cancelledSessions = parseInt(sessionStats.rows[0].cancelled);
    
    const completionRate = totalSessions > 0 
      ? ((completedSessions / (totalSessions - cancelledSessions)) * 100).toFixed(1)
      : '0';

    // 9. Rating Statistics from Review table
    const ratingStats = await query(
      `SELECT 
        COALESCE(AVG(r."Rating"), 0) as "averageRating",
        COUNT(*) as "totalRatings",
        COUNT(*) FILTER (WHERE r."Rating" = 5) as "fiveStar",
        COUNT(*) FILTER (WHERE r."Rating" = 4) as "fourStar",
        COUNT(*) FILTER (WHERE r."Rating" = 3) as "threeStar",
        COUNT(*) FILTER (WHERE r."Rating" = 2) as "twoStar",
        COUNT(*) FILTER (WHERE r."Rating" = 1) as "oneStar",
        COUNT(*) FILTER (WHERE r."Rating" >= 4) as "positiveRatings",
        COUNT(*) FILTER (WHERE r."Rating" >= 4.5) as "excellentRatings"
       FROM "Review" r
       JOIN "Session" s ON r."SessionID" = s."SessionID"
       WHERE s."MentorID" = $1 AND r."IsPublic" = true`,
      [userId]
    );

    // 10. Monthly Trends (last 6 months)
    const monthlyTrends = await query(
      `SELECT 
        DATE_TRUNC('month', "ScheduledStart") as "month",
        COUNT(*) as "totalSessions",
        COUNT(*) FILTER (WHERE "Status" = 'COMPLETED') as "completedSessions"
       FROM "Session" 
       WHERE "MentorID" = $1 
         AND "ScheduledStart" >= NOW() - INTERVAL '6 months'
       GROUP BY DATE_TRUNC('month', "ScheduledStart")
       ORDER BY "month" DESC`,
      [userId]
    );

    // 11. Weekly Schedule Distribution
    const weeklyDistribution = await query(
      `SELECT 
        "DayOfWeek",
        COUNT(*) as "slotsCount"
       FROM "Availability" 
       WHERE "UserID" = $1 AND "IsRecurring" = true AND "IsActive" = true
       GROUP BY "DayOfWeek"
       ORDER BY "DayOfWeek"`,
      [userId]
    );

    // 12. Recent Reviews (last 5 reviews)
    const recentReviews = await query(
      `SELECT 
        r."Rating",
        r."Comment",
        r."CreatedAt",
        u."FullName" as "ReviewerName",
        u."ProfileImageURL" as "ReviewerImage",
        s."Title" as "SessionTitle"
       FROM "Review" r
       JOIN "User" u ON r."ReviewerID" = u."UserID"
       JOIN "Session" s ON r."SessionID" = s."SessionID"
       WHERE s."MentorID" = $1 AND r."IsPublic" = true
       ORDER BY r."CreatedAt" DESC
       LIMIT 5`,
      [userId]
    );

    // Combine all stats
    return res.status(200).json({
      success: true,
      data: {
        overview: {
          totalSessions: parseInt(sessionStats.rows[0].total),
          completedSessions: parseInt(sessionStats.rows[0].completed),
          completionRate: parseFloat(completionRate),
          totalTeachingHours: parseFloat(durationStats.rows[0]?.totalTeachingHours || 0),
          averageSessionHours: parseFloat(durationStats.rows[0]?.averageSessionHours || 0),
          averageRating: parseFloat(ratingStats.rows[0]?.averageRating || 0),
          totalRatings: parseInt(ratingStats.rows[0]?.totalRatings || 0),
          totalLearners: parseInt(learnerStats.rows[0].totalUniqueLearners),
          activeSkills: parseInt(skillStats.rows[0].availableSkills),
        },
        sessions: {
          pendingMatch: parseInt(sessionStats.rows[0].pendingMatch),
          scheduled: parseInt(sessionStats.rows[0].scheduled),
          inProgress: parseInt(sessionStats.rows[0].inProgress),
          completed: parseInt(sessionStats.rows[0].completed),
          cancelled: parseInt(sessionStats.rows[0].cancelled),
          reported: parseInt(sessionStats.rows[0].reported),
        },
        teaching: {
          totalTeachingHours: parseFloat(durationStats.rows[0]?.totalTeachingHours || 0),
          averageSessionHours: parseFloat(durationStats.rows[0]?.averageSessionHours || 0),
          completedSessions: parseInt(sessionStats.rows[0].completed),
        },
        skills: {
          totalSkills: parseInt(skillStats.rows[0].totalSkills),
          availableSkills: parseInt(skillStats.rows[0].availableSkills),
          unavailableSkills: parseInt(skillStats.rows[0].unavailableSkills),
          popularSkills: popularSkills.rows,
        },
        availability: {
          weeklySlots: parseInt(availabilityStats.rows[0].weeklySlots),
          upcomingSpecificSlots: parseInt(availabilityStats.rows[0].upcomingSpecificSlots),
          totalActiveSlots: parseInt(availabilityStats.rows[0].totalActiveSlots),
          weeklyDistribution: weeklyDistribution.rows,
        },
        learners: {
          totalUniqueLearners: parseInt(learnerStats.rows[0].totalUniqueLearners),
          completedWithLearners: parseInt(learnerStats.rows[0].completedWithLearners),
          upcomingWithLearners: parseInt(learnerStats.rows[0].upcomingWithLearners),
        },
        ratings: {
          averageRating: parseFloat(ratingStats.rows[0]?.averageRating || 0),
          totalRatings: parseInt(ratingStats.rows[0]?.totalRatings || 0),
          distribution: {
            5: parseInt(ratingStats.rows[0]?.fiveStar || 0),
            4: parseInt(ratingStats.rows[0]?.fourStar || 0),
            3: parseInt(ratingStats.rows[0]?.threeStar || 0),
            2: parseInt(ratingStats.rows[0]?.twoStar || 0),
            1: parseInt(ratingStats.rows[0]?.oneStar || 0),
          },
          positiveRatings: parseInt(ratingStats.rows[0]?.positiveRatings || 0),
          excellentRatings: parseInt(ratingStats.rows[0]?.excellentRatings || 0),
        },
        recentReviews: recentReviews.rows,
        trends: {
          recentPerformance: recentPerformance.rows,
          monthlyTrends: monthlyTrends.rows,
        },
      },
    });
  } catch (error) {
    console.error("Get mentor stats error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch mentor statistics: " + (error as Error).message)],
    });
  }
});