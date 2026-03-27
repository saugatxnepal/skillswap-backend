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

    // Check if user is mentor
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

    // Check if category exists
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

    // Check if mentor already has a skill with this name
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

    // Create the skill
    const skillResult = await query(
      `INSERT INTO "Skill" 
       ("SkillID", "Name", "Description", "DetailedContent", "SkillCategoryID", "IsAvailable")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
       RETURNING *`,
      [name.trim(), description || null, detailedContent || null, skillCategoryId]
    );

    const newSkill = skillResult.rows[0];

    // Link skill to mentor - FIXED: Added UpdatedAt with NOW()
    const userSkillResult = await query(
      `INSERT INTO "UserSkill" 
       ("UserSkillID", "UserID", "SkillID", "IsMentor", "IsLearner", 
        "ExperienceLevel", "TeachingStyle", "CreatedAt", "UpdatedAt")
       VALUES (gen_random_uuid(), $1, $2, true, false, $3, $4, NOW(), NOW())
       RETURNING *`,
      [userId, newSkill.SkillID, experienceLevel || null, teachingStyle || null]
    );

    // Clear cache
    await RedisService.del(CacheKeys.userSkills(userId));
    await RedisService.delPattern(`mentor:${userId}:skills:*`);

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
    const { includeUnavailable = false } = req.query;

    const cacheKey = includeUnavailable 
      ? `mentor:${userId}:skills:all`
      : `mentor:${userId}:skills:available`;
    
    let skills = await RedisService.get(cacheKey);

    if (!skills) {
      let queryText = `
        SELECT s.*, us."ExperienceLevel", us."TeachingStyle", 
               us."CreatedAt" as "AddedAt", sc."Name" as "CategoryName",
               sc."SkillCategoryID" as "CategoryId"
        FROM "Skill" s
        JOIN "UserSkill" us ON s."SkillID" = us."SkillID"
        LEFT JOIN "SkillCategory" sc ON s."SkillCategoryID" = sc."SkillCategoryID"
        WHERE us."UserID" = $1 AND us."IsMentor" = true
      `;
      
      if (!includeUnavailable) {
        queryText += ` AND s."IsAvailable" = true`;
      }

      queryText += ` ORDER BY sc."DisplayOrder", s."Name"`;

      const result = await query(queryText, [userId]);
      skills = result.rows;
      
      await RedisService.setEx(cacheKey, 300, skills);
    }

    return res.status(200).json({
      success: true,
      data: skills,
      fromCache: true,
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

    // Check if user owns this skill
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

    // Update skill details
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

      updates.push(`"UpdatedAt" = NOW()`);
      values.push(skillId);
      await query(
        `UPDATE "Skill" 
         SET ${updates.join(', ')}
         WHERE "SkillID" = $${paramCount}`,
        values
      );
    }

    // Update user skill details
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

      updates.push(`"UpdatedAt" = NOW()`);
      values.push(userId, skillId);
      await query(
        `UPDATE "UserSkill" 
         SET ${updates.join(', ')}
         WHERE "UserID" = $${paramCount} AND "SkillID" = $${paramCount + 1}`,
        values
      );
    }

    // Clear cache
    await RedisService.delPattern(`mentor:${userId}:skills:*`);
    await RedisService.del(CacheKeys.userSkills(userId));

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

    // Check if user owns this skill
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

    // Update skill availability
    const result = await query(
      `UPDATE "Skill" 
       SET "IsAvailable" = $1, "UpdatedAt" = NOW()
       WHERE "SkillID" = $2
       RETURNING *`,
      [isAvailable, skillId]
    );

    // Clear cache
    await RedisService.delPattern(`mentor:${userId}:skills:*`);
    await RedisService.del(CacheKeys.userSkills(userId));

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

    // Check if there are active sessions for this skill
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

    // Delete user skill relation
    await query(
      `DELETE FROM "UserSkill" 
       WHERE "UserID" = $1 AND "SkillID" = $2 AND "IsMentor" = true`,
      [userId, skillId]
    );

    // Delete the skill itself
    await query(
      `DELETE FROM "Skill" WHERE "SkillID" = $1`,
      [skillId]
    );

    // Clear cache
    await RedisService.delPattern(`mentor:${userId}:skills:*`);
    await RedisService.del(CacheKeys.userSkills(userId));

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

// ==================== AVAILABILITY MANAGEMENT (TIMING) ====================

// Set weekly availability
export const setWeeklyAvailability = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { availability } = req.body; // Array of { dayOfWeek, startTime, endTime }

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

      const result = await query(
        `INSERT INTO "Availability" 
         ("AvailabilityID", "UserID", "DayOfWeek", "StartTime", "EndTime", "IsRecurring", "IsActive")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, true, true)
         RETURNING *`,
        [userId, dayOfWeek, startTime, endTime]
      );
      inserted.push(result.rows[0]);
    }

    // Clear cache
    await RedisService.del(CacheKeys.userAvailability(userId));
    await RedisService.delPattern(`availability:${userId}:*`);

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

// Get mentor's availability (for showing to learners)
export const getMentorAvailability = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { mentorId } = req.params;

    if (!mentorId) {
      return res.status(400).json({
        success: false,
        errors: [formatError("mentorId", "Mentor ID is required")],
      });
    }

    const cacheKey = `availability:mentor:${mentorId}`;
    let availability = await RedisService.get(cacheKey);

    if (!availability) {
      // Get weekly recurring availability
      const weeklyResult = await query(
        `SELECT * FROM "Availability" 
         WHERE "UserID" = $1 AND "IsRecurring" = true AND "IsActive" = true
         ORDER BY "DayOfWeek", "StartTime"`,
        [mentorId]
      );

      // Get specific one-time availability
      const specificResult = await query(
        `SELECT * FROM "Availability" 
         WHERE "UserID" = $1 AND "IsRecurring" = false AND "IsActive" = true
           AND "SpecificDate" >= NOW()
         ORDER BY "SpecificDate", "StartTime"`,
        [mentorId]
      );

      availability = {
        weekly: weeklyResult.rows,
        specific: specificResult.rows,
      };

      await RedisService.setEx(cacheKey, 300, availability);
    }

    return res.status(200).json({
      success: true,
      data: availability,
      fromCache: true,
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
    
    const cacheKey = `availability:mentor:${userId}`;
    let availability = await RedisService.get(cacheKey);

    if (!availability) {
      // Get weekly recurring availability
      const weeklyResult = await query(
        `SELECT * FROM "Availability" 
         WHERE "UserID" = $1 AND "IsRecurring" = true AND "IsActive" = true
         ORDER BY "DayOfWeek", "StartTime"`,
        [userId]
      );

      // Get specific one-time availability
      const specificResult = await query(
        `SELECT * FROM "Availability" 
         WHERE "UserID" = $1 AND "IsRecurring" = false AND "IsActive" = true
           AND "SpecificDate" >= NOW()
         ORDER BY "SpecificDate", "StartTime"`,
        [userId]
      );

      availability = {
        weekly: weeklyResult.rows,
        specific: specificResult.rows,
      };

      await RedisService.setEx(cacheKey, 300, availability);
    }

    return res.status(200).json({
      success: true,
      data: availability,
      fromCache: true,
    });
  } catch (error) {
    console.error("Get my availability error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch availability")],
    });
  }
});

// Add specific date availability (one-time)
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

    const result = await query(
      `INSERT INTO "Availability" 
       ("AvailabilityID", "UserID", "DayOfWeek", "StartTime", "EndTime", "IsRecurring", "SpecificDate", "IsActive")
       VALUES (gen_random_uuid(), $1, EXTRACT(DOW FROM $2::date), $3, $4, false, $2, true)
       RETURNING *`,
      [userId, specificDate, startTime, endTime]
    );

    // Clear cache
    await RedisService.del(CacheKeys.userAvailability(userId));
    await RedisService.delPattern(`availability:mentor:${userId}`);

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

    // Clear cache
    await RedisService.del(CacheKeys.userAvailability(userId));
    await RedisService.delPattern(`availability:mentor:${userId}`);

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
             u."Email" as "LearnerEmail"
      FROM "Session" s
      JOIN "User" u ON s."LearnerID" = u."UserID"
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

    // Get total count
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

    // Get session skills
    const skills = await query(
      `SELECT s.* FROM "Skill" s
       JOIN "SessionSkill" ss ON s."SkillID" = ss."SkillID"
       WHERE ss."SessionID" = $1`,
      [sessionId]
    );

    // Get session participants
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

    // Check if user is mentor of this session
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

    // Clear cache
    await RedisService.delPattern(`session:${sessionId}:*`);

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