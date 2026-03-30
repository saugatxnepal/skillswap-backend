// src/controllers/adminDashboard.controller.ts
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

enum ReportStatus {
  PENDING = "PENDING",
  REVIEWED = "REVIEWED",
  RESOLVED = "RESOLVED",
  DISMISSED = "DISMISSED",
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

// Get main dashboard statistics
export const getDashboardStats = asyncHandler(async (req: Request, res: Response) => {
  try {
    const currentUserRole = (req as any).user?.role;

    if (currentUserRole !== Role.Admin) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only admin can view dashboard statistics")],
      });
    }

    // Get user statistics
    const userStats = await query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN "Role" = 'Mentor' THEN 1 END) as total_mentors,
        COUNT(CASE WHEN "Role" = 'Learner' THEN 1 END) as total_learners,
        COUNT(CASE WHEN "Status" = 'Active' THEN 1 END) as active_users,
        COUNT(CASE WHEN "Status" = 'Inactive' THEN 1 END) as inactive_users,
        COUNT(CASE WHEN "Status" = 'Banned' THEN 1 END) as banned_users,
        COUNT(CASE WHEN "CreatedAt" > NOW() - INTERVAL '7 days' THEN 1 END) as new_users_week,
        COUNT(CASE WHEN "CreatedAt" > NOW() - INTERVAL '30 days' THEN 1 END) as new_users_month
      FROM "User"
    `);

    // Get session statistics
    const sessionStats = await query(`
      SELECT 
        COUNT(*) as total_sessions,
        COUNT(CASE WHEN "Status" = 'PENDING_MATCH' THEN 1 END) as pending_match,
        COUNT(CASE WHEN "Status" = 'SCHEDULED' THEN 1 END) as scheduled,
        COUNT(CASE WHEN "Status" = 'IN_PROGRESS' THEN 1 END) as in_progress,
        COUNT(CASE WHEN "Status" = 'COMPLETED' THEN 1 END) as completed,
        COUNT(CASE WHEN "Status" = 'CANCELLED' THEN 1 END) as cancelled,
        COUNT(CASE WHEN "Status" = 'REPORTED' THEN 1 END) as reported,
        COUNT(CASE WHEN "CreatedAt" > NOW() - INTERVAL '7 days' THEN 1 END) as new_sessions_week,
        COUNT(CASE WHEN "CreatedAt" > NOW() - INTERVAL '30 days' THEN 1 END) as new_sessions_month,
        COALESCE(AVG("Duration"), 0) as avg_duration_minutes
      FROM "Session"
    `);

    // Get skill statistics
    const skillStats = await query(`
      SELECT 
        COUNT(*) as total_skills,
        COUNT(CASE WHEN "IsAvailable" = true THEN 1 END) as available_skills,
        COUNT(DISTINCT "SkillCategoryID") as total_categories,
        COUNT(DISTINCT us."UserID") as mentors_with_skills
      FROM "Skill" s
      LEFT JOIN "UserSkill" us ON s."SkillID" = us."SkillID" AND us."IsMentor" = true
    `);

    // Get review statistics
    const reviewStats = await query(`
      SELECT 
        COUNT(*) as total_reviews,
        COALESCE(AVG("Rating"), 0) as avg_rating,
        COUNT(DISTINCT "SessionID") as sessions_reviewed,
        COUNT(CASE WHEN "Rating" = 5 THEN 1 END) as five_star,
        COUNT(CASE WHEN "Rating" = 4 THEN 1 END) as four_star,
        COUNT(CASE WHEN "Rating" = 3 THEN 1 END) as three_star,
        COUNT(CASE WHEN "Rating" = 2 THEN 1 END) as two_star,
        COUNT(CASE WHEN "Rating" = 1 THEN 1 END) as one_star
      FROM "Review"
    `);

    // Get report statistics
    const reportStats = await query(`
      SELECT 
        COUNT(*) as total_reports,
        COUNT(CASE WHEN "Status" = 'PENDING' THEN 1 END) as pending,
        COUNT(CASE WHEN "Status" = 'REVIEWED' THEN 1 END) as reviewed,
        COUNT(CASE WHEN "Status" = 'RESOLVED' THEN 1 END) as resolved,
        COUNT(CASE WHEN "Status" = 'DISMISSED' THEN 1 END) as dismissed,
        COUNT(CASE WHEN "CreatedAt" > NOW() - INTERVAL '7 days' THEN 1 END) as new_reports_week
      FROM "Report"
    `);

    // Get engagement statistics
    const engagementStats = await query(`
      SELECT 
        (SELECT COUNT(*) FROM "Message") as total_messages,
        (SELECT COUNT(*) FROM "Notification" WHERE "IsRead" = false) as unread_notifications,
        (SELECT COUNT(*) FROM "SessionQuestion" WHERE "IsAnswered" = false) as unanswered_questions
    `);

    return res.status(200).json({
      success: true,
      data: {
        users: userStats.rows[0],
        sessions: sessionStats.rows[0],
        skills: skillStats.rows[0],
        reviews: reviewStats.rows[0],
        reports: reportStats.rows[0],
        engagement: engagementStats.rows[0],
      },
    });
  } catch (error) {
    console.error("[AdminDashboard] Get stats error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch dashboard statistics")],
    });
  }
});

// Get user growth chart data
export const getUserGrowthChart = asyncHandler(async (req: Request, res: Response) => {
  try {
    const currentUserRole = (req as any).user?.role;

    if (currentUserRole !== Role.Admin) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only admin can view user growth data")],
      });
    }

    const { period = 'month' } = req.query; // day, week, month, year

    let interval: string;
    let format: string;

    switch (period) {
      case 'day':
        interval = '24 hours';
        format = 'HH24:00';
        break;
      case 'week':
        interval = '7 days';
        format = 'YYYY-MM-DD';
        break;
      case 'year':
        interval = '12 months';
        format = 'YYYY-MM';
        break;
      default: // month
        interval = '30 days';
        format = 'YYYY-MM-DD';
    }

    const result = await query(
      `
      SELECT 
        TO_CHAR(date_series, $1) as date,
        COALESCE(user_count, 0) as new_users,
        COALESCE(mentor_count, 0) as new_mentors,
        COALESCE(learner_count, 0) as new_learners
      FROM generate_series(
        NOW() - $2::interval, 
        NOW(), 
        '1 day'::interval
      ) AS date_series
      LEFT JOIN (
        SELECT 
          DATE("CreatedAt") as created_date,
          COUNT(*) as user_count,
          COUNT(CASE WHEN "Role" = 'Mentor' THEN 1 END) as mentor_count,
          COUNT(CASE WHEN "Role" = 'Learner' THEN 1 END) as learner_count
        FROM "User"
        WHERE "CreatedAt" > NOW() - $2::interval
        GROUP BY DATE("CreatedAt")
      ) u ON date_series::date = u.created_date
      ORDER BY date_series ASC
      `,
      [format, interval]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("[AdminDashboard] Get user growth error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch user growth data")],
    });
  }
});

// Get session trends chart data
export const getSessionTrends = asyncHandler(async (req: Request, res: Response) => {
  try {
    const currentUserRole = (req as any).user?.role;

    if (currentUserRole !== Role.Admin) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only admin can view session trends")],
      });
    }

    const { period = 'month' } = req.query;

    let interval: string;
    let format: string;

    switch (period) {
      case 'week':
        interval = '7 days';
        format = 'YYYY-MM-DD';
        break;
      case 'year':
        interval = '12 months';
        format = 'YYYY-MM';
        break;
      default: // month
        interval = '30 days';
        format = 'YYYY-MM-DD';
    }

    const result = await query(
      `
      SELECT 
        TO_CHAR(date_series, $1) as date,
        COALESCE(total_sessions, 0) as total_sessions,
        COALESCE(completed_sessions, 0) as completed,
        COALESCE(cancelled_sessions, 0) as cancelled,
        COALESCE(avg_duration, 0) as avg_duration
      FROM generate_series(
        NOW() - $2::interval, 
        NOW(), 
        '1 day'::interval
      ) AS date_series
      LEFT JOIN (
        SELECT 
          DATE("CreatedAt") as session_date,
          COUNT(*) as total_sessions,
          COUNT(CASE WHEN "Status" = 'COMPLETED' THEN 1 END) as completed_sessions,
          COUNT(CASE WHEN "Status" = 'CANCELLED' THEN 1 END) as cancelled_sessions,
          AVG(CASE WHEN "Status" = 'COMPLETED' THEN "Duration" END) as avg_duration
        FROM "Session"
        WHERE "CreatedAt" > NOW() - $2::interval
        GROUP BY DATE("CreatedAt")
      ) s ON date_series::date = s.session_date
      ORDER BY date_series ASC
      `,
      [format, interval]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("[AdminDashboard] Get session trends error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch session trends")],
    });
  }
});

// Get top mentors by rating and sessions
export const getTopMentors = asyncHandler(async (req: Request, res: Response) => {
  try {
    const currentUserRole = (req as any).user?.role;

    if (currentUserRole !== Role.Admin) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only admin can view top mentors")],
      });
    }

    const limit = getQueryNumber(req.query.limit, 10);

    const result = await query(
      `
      SELECT 
        u."UserID",
        u."FullName",
        u."Email",
        u."ProfileImageURL",
        u."CreatedAt",
        COUNT(DISTINCT s."SessionID") as total_sessions,
        COUNT(DISTINCT CASE WHEN s."Status" = 'COMPLETED' THEN s."SessionID" END) as completed_sessions,
        COALESCE(AVG(r."Rating"), 0) as avg_rating,
        COUNT(DISTINCT r."ReviewID") as total_reviews,
        COUNT(DISTINCT us."SkillID") as skills_count
      FROM "User" u
      LEFT JOIN "Session" s ON u."UserID" = s."MentorID"
      LEFT JOIN "Review" r ON u."UserID" = r."RevieweeID" AND r."IsMentorReview" = true
      LEFT JOIN "UserSkill" us ON u."UserID" = us."UserID" AND us."IsMentor" = true
      WHERE u."Role" = 'Mentor' AND u."Status" = 'Active'
      GROUP BY u."UserID"
      ORDER BY avg_rating DESC, completed_sessions DESC
      LIMIT $1
      `,
      [limit]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("[AdminDashboard] Get top mentors error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch top mentors")],
    });
  }
});

// Get popular skills
export const getPopularSkills = asyncHandler(async (req: Request, res: Response) => {
  try {
    const currentUserRole = (req as any).user?.role;

    if (currentUserRole !== Role.Admin) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only admin can view popular skills")],
      });
    }

    const limit = getQueryNumber(req.query.limit, 10);

    const result = await query(
      `
      SELECT 
        s."SkillID",
        s."Name",
        sc."Name" as "CategoryName",
        COUNT(DISTINCT us."UserID") as mentor_count,
        COUNT(DISTINCT ss."SessionID") as session_count,
        COUNT(DISTINCT ss."SessionID" FILTER (WHERE ses."Status" = 'COMPLETED')) as completed_sessions
      FROM "Skill" s
      LEFT JOIN "SkillCategory" sc ON s."SkillCategoryID" = sc."SkillCategoryID"
      LEFT JOIN "UserSkill" us ON s."SkillID" = us."SkillID" AND us."IsMentor" = true
      LEFT JOIN "SessionSkill" ss ON s."SkillID" = ss."SkillID"
      LEFT JOIN "Session" ses ON ss."SessionID" = ses."SessionID"
      WHERE s."IsAvailable" = true
      GROUP BY s."SkillID", sc."Name"
      ORDER BY mentor_count DESC, session_count DESC
      LIMIT $1
      `,
      [limit]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("[AdminDashboard] Get popular skills error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch popular skills")],
    });
  }
});

// Get all sessions (admin view with filters)
export const getAllSessionsAdmin = asyncHandler(async (req: Request, res: Response) => {
  try {
    const currentUserRole = (req as any).user?.role;

    if (currentUserRole !== Role.Admin) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only admin can view all sessions")],
      });
    }

    const page = getQueryNumber(req.query.page, 1);
    const limit = getQueryNumber(req.query.limit, 20);
    const offset = (page - 1) * limit;
    const status = getQueryString(req.query.status);
    const search = getQueryString(req.query.search);
    const startDate = getQueryString(req.query.startDate);
    const endDate = getQueryString(req.query.endDate);

    let queryText = `
      SELECT 
        s.*,
        m."FullName" as "mentorName",
        m."Email" as "mentorEmail",
        l."FullName" as "learnerName",
        l."Email" as "learnerEmail",
        COUNT(DISTINCT r."ReviewID") as review_count,
        COUNT(DISTINCT rep."ReportID") as report_count
      FROM "Session" s
      JOIN "User" m ON s."MentorID" = m."UserID"
      JOIN "User" l ON s."LearnerID" = l."UserID"
      LEFT JOIN "Review" r ON s."SessionID" = r."SessionID"
      LEFT JOIN "Report" rep ON s."SessionID" = rep."SessionID"
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      queryText += ` AND s."Status" = $${paramCount}`;
      params.push(status);
    }

    if (search) {
      paramCount++;
      queryText += ` AND (s."Title" ILIKE $${paramCount} OR m."FullName" ILIKE $${paramCount} OR l."FullName" ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (startDate) {
      paramCount++;
      queryText += ` AND s."ScheduledStart" >= $${paramCount}`;
      params.push(startDate);
    }

    if (endDate) {
      paramCount++;
      queryText += ` AND s."ScheduledEnd" <= $${paramCount}`;
      params.push(endDate);
    }

    queryText += ` GROUP BY s."SessionID", m."FullName", m."Email", l."FullName", l."Email"
                   ORDER BY s."CreatedAt" DESC
                   LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM "Session" WHERE 1=1`;
    if (status) {
      countQuery += ` AND "Status" = $1`;
      const countResult = await query(countQuery, [status]);
      const total = parseInt(countResult.rows[0].count);
      return res.status(200).json({
        success: true,
        data: {
          sessions: result.rows,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      });
    } else {
      const countResult = await query(countQuery);
      const total = parseInt(countResult.rows[0].count);
      return res.status(200).json({
        success: true,
        data: {
          sessions: result.rows,
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
    console.error("[AdminDashboard] Get all sessions error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch sessions")],
    });
  }
});

// Get platform activity logs
export const getActivityLogs = asyncHandler(async (req: Request, res: Response) => {
  try {
    const currentUserRole = (req as any).user?.role;

    if (currentUserRole !== Role.Admin) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only admin can view activity logs")],
      });
    }

    const page = getQueryNumber(req.query.page, 1);
    const limit = getQueryNumber(req.query.limit, 50);
    const offset = (page - 1) * limit;
    const type = getQueryString(req.query.type);
    const userId = getQueryString(req.query.userId);

    // Get recent sessions
    let queryText = `
      SELECT 
        'session' as type,
        s."SessionID" as id,
        s."Title" as title,
        s."Status" as status,
        s."CreatedAt" as created_at,
        m."FullName" as mentor_name,
        l."FullName" as learner_name
      FROM "Session" s
      JOIN "User" m ON s."MentorID" = m."UserID"
      JOIN "User" l ON s."LearnerID" = l."UserID"
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;

    if (type === 'session') {
      // Only sessions
    } else if (type === 'user') {
      // Get user registrations
      queryText = `
        SELECT 
          'user_registration' as type,
          u."UserID" as id,
          u."FullName" as name,
          u."Role" as role,
          u."CreatedAt" as created_at
        FROM "User" u
        WHERE 1=1
      `;
    } else if (type === 'report') {
      // Get reports
      queryText = `
        SELECT 
          'report' as type,
          r."ReportID" as id,
          r."Reason" as reason,
          r."Status" as status,
          r."CreatedAt" as created_at,
          rep."FullName" as reporter_name,
          reported."FullName" as reported_name
        FROM "Report" r
        JOIN "User" rep ON r."ReporterID" = rep."UserID"
        JOIN "User" reported ON r."ReportedUserID" = reported."UserID"
        WHERE 1=1
      `;
    } else {
      // Combine all
      queryText = `
        (SELECT 
          'session' as type,
          s."SessionID" as id,
          s."Title" as title,
          s."Status" as status,
          s."CreatedAt" as created_at,
          m."FullName" as mentor_name,
          l."FullName" as learner_name,
          NULL as name,
          NULL as role
        FROM "Session" s
        JOIN "User" m ON s."MentorID" = m."UserID"
        JOIN "User" l ON s."LearnerID" = l."UserID")
        
        UNION ALL
        
        (SELECT 
          'user_registration' as type,
          u."UserID" as id,
          NULL as title,
          NULL as status,
          u."CreatedAt" as created_at,
          NULL as mentor_name,
          NULL as learner_name,
          u."FullName" as name,
          u."Role" as role
        FROM "User" u)
        
        UNION ALL
        
        (SELECT 
          'report' as type,
          r."ReportID" as id,
          r."Reason" as title,
          r."Status" as status,
          r."CreatedAt" as created_at,
          NULL as mentor_name,
          NULL as learner_name,
          rep."FullName" as name,
          NULL as role
        FROM "Report" r
        JOIN "User" rep ON r."ReporterID" = rep."UserID")
        
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `;
      params.push(limit, offset);
      
      const result = await query(queryText, params);
      const total = 1000; // Approximate total for pagination
      
      return res.status(200).json({
        success: true,
        data: {
          logs: result.rows,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      });
    }

    if (type === 'user') {
      if (userId) {
        queryText += ` AND u."UserID" = $${paramCount + 1}`;
        params.push(userId);
        paramCount++;
      }
      queryText += ` ORDER BY u."CreatedAt" DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limit, offset);
    } else {
      if (userId) {
        queryText += ` AND (s."MentorID" = $${paramCount + 1} OR s."LearnerID" = $${paramCount + 1})`;
        params.push(userId);
        paramCount++;
      }
      queryText += ` ORDER BY s."CreatedAt" DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limit, offset);
    }

    const result = await query(queryText, params);
    const total = result.rows.length;

    return res.status(200).json({
      success: true,
      data: {
        logs: result.rows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("[AdminDashboard] Get activity logs error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch activity logs")],
    });
  }
});

// Get admin alerts (pending reports, inactive users, etc.)
export const getAdminAlerts = asyncHandler(async (req: Request, res: Response) => {
  try {
    const currentUserRole = (req as any).user?.role;

    if (currentUserRole !== Role.Admin) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only admin can view alerts")],
      });
    }

    // Pending reports
    const pendingReports = await query(`
      SELECT COUNT(*) as count
      FROM "Report"
      WHERE "Status" = 'PENDING'
    `);

    // Inactive mentors (no sessions in last 30 days)
    const inactiveMentors = await query(`
      SELECT COUNT(DISTINCT u."UserID") as count
      FROM "User" u
      LEFT JOIN "Session" s ON u."UserID" = s."MentorID" AND s."CreatedAt" > NOW() - INTERVAL '30 days'
      WHERE u."Role" = 'Mentor' 
        AND u."Status" = 'Active'
        AND s."SessionID" IS NULL
    `);

    // Reported sessions pending resolution
    const reportedSessions = await query(`
      SELECT COUNT(*) as count
      FROM "Session"
      WHERE "Status" = 'REPORTED'
    `);

    // Users with many reports (potential troublemakers)
    const flaggedUsers = await query(`
      SELECT 
        r."ReportedUserID",
        u."FullName",
        u."Email",
        COUNT(*) as report_count
      FROM "Report" r
      JOIN "User" u ON r."ReportedUserID" = u."UserID"
      WHERE r."Status" != 'DISMISSED'
      GROUP BY r."ReportedUserID", u."FullName", u."Email"
      HAVING COUNT(*) >= 3
      ORDER BY report_count DESC
      LIMIT 10
    `);

    // Upcoming sessions without meeting link
    const missingMeetingLinks = await query(`
      SELECT COUNT(*) as count
      FROM "Session"
      WHERE "Status" = 'SCHEDULED' 
        AND "ScheduledStart" > NOW()
        AND "MeetingLink" IS NULL
    `);

    return res.status(200).json({
      success: true,
      data: {
        pendingReports: parseInt(pendingReports.rows[0].count),
        inactiveMentors: parseInt(inactiveMentors.rows[0].count),
        reportedSessions: parseInt(reportedSessions.rows[0].count),
        missingMeetingLinks: parseInt(missingMeetingLinks.rows[0].count),
        flaggedUsers: flaggedUsers.rows,
      },
    });
  } catch (error) {
    console.error("[AdminDashboard] Get admin alerts error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch admin alerts")],
    });
  }
});