// src/controllers/report.controller.ts
import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";
import { createUploader } from "../middlewares/uploadHandler";

enum ReportReason {
  INAPPROPRIATE_BEHAVIOR = "INAPPROPRIATE_BEHAVIOR",
  TECHNICAL_ISSUES = "TECHNICAL_ISSUES",
  NO_SHOW = "NO_SHOW",
  HARASSMENT = "HARASSMENT",
  SPAM = "SPAM",
  OTHER = "OTHER",
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

// Create uploader for evidence files
const evidenceUpload = createUploader('reports');

// Submit a report
export const submitReport = asyncHandler(async (req: Request, res: Response) => {
  try {
    const reporterId = (req as any).user?.UserID;
    const { sessionId } = req.params;
    const { reason, description, reportedUserId } = req.body;

    if (!reason || !description) {
      return res.status(400).json({
        success: false,
        errors: [formatError("fields", "Reason and description are required")],
      });
    }

    // If sessionId is provided, verify session exists
    let reportedUserIdFinal = reportedUserId;
    let sessionInfo = null;

    if (sessionId) {
      const sessionCheck = await query(
        `SELECT * FROM "Session" 
         WHERE "SessionID" = $1 AND ("MentorID" = $2 OR "LearnerID" = $2)`,
        [sessionId, reporterId]
      );

      if (sessionCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          errors: [formatError("session", "Session not found or you are not part of it")],
        });
      }

      sessionInfo = sessionCheck.rows[0];
      
      // Determine reported user (the other participant)
      if (!reportedUserId) {
        reportedUserIdFinal = sessionInfo.MentorID === reporterId 
          ? sessionInfo.LearnerID 
          : sessionInfo.MentorID;
      }
    }

    if (!reportedUserIdFinal) {
      return res.status(400).json({
        success: false,
        errors: [formatError("reportedUser", "Reported user ID is required")],
      });
    }

    // Check if already reported
    const existingReport = await query(
      `SELECT * FROM "Report" 
       WHERE "SessionID" = $1 AND "ReporterID" = $2`,
      [sessionId || null, reporterId]
    );

    if (sessionId && existingReport.rows.length > 0) {
      return res.status(400).json({
        success: false,
        errors: [formatError("report", "You have already reported this session")],
      });
    }

    // Handle evidence files
    const evidence = [];
    if (req.files && Array.isArray(req.files)) {
      for (const file of req.files) {
        evidence.push(`/uploads/reports/${file.filename}`);
      }
    }

    // Insert report
    const result = await query(
      `INSERT INTO "Report" 
       ("ReportID", "SessionID", "ReporterID", "ReportedUserID", 
        "Reason", "Description", "Evidence", "Status", "CreatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [sessionId || null, reporterId, reportedUserIdFinal, reason, description, 
       evidence.length > 0 ? JSON.stringify(evidence) : null, ReportStatus.PENDING]
    );

    const newReport = result.rows[0];

    // Notify admin
    const admins = await query(
      `SELECT "UserID" FROM "User" WHERE "Role" = 'Admin' AND "Status" = 'Active'`
    );

    for (const admin of admins.rows) {
      await query(
        `INSERT INTO "Notification" 
         ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
         VALUES (gen_random_uuid(), $1, 'REPORT_RESOLVED', $2, $3, $4, NOW())`,
        [admin.UserID, "New Report Submitted", 
         `A new report has been submitted for review`,
         JSON.stringify({ reportId: newReport.ReportID, sessionId, reason })]
      );
    }

    // Notify reported user (optional - depending on policy)
    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
       VALUES (gen_random_uuid(), $1, 'REPORT_RESOLVED', $2, $3, $4, NOW())`,
      [reportedUserIdFinal, "Report Received", 
       `A report has been filed regarding a recent session. Our team will review it.`,
       JSON.stringify({ reportId: newReport.ReportID })]
    );

    return res.status(201).json({
      success: true,
      data: newReport,
      message: "Report submitted successfully. Our team will review it.",
    });
  } catch (error) {
    console.error("[Report] Submit error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to submit report: " + (error as Error).message)],
    });
  }
});

// Get my reports (as reporter)
export const getMyReports = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const page = getQueryNumber(req.query.page, 1);
    const limit = getQueryNumber(req.query.limit, 10);
    const offset = (page - 1) * limit;
    const status = getQueryString(req.query.status);

    let queryText = `
      SELECT r.*, 
             u."FullName" as "ReportedUserName",
             u."Email" as "ReportedUserEmail",
             s."Title" as "SessionTitle"
      FROM "Report" r
      JOIN "User" u ON r."ReportedUserID" = u."UserID"
      LEFT JOIN "Session" s ON r."SessionID" = s."SessionID"
      WHERE r."ReporterID" = $1
    `;
    const params: any[] = [userId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      queryText += ` AND r."Status" = $${paramCount}`;
      params.push(status);
    }

    queryText += ` ORDER BY r."CreatedAt" DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM "Report" WHERE "ReporterID" = $1`;
    if (status) {
      countQuery += ` AND "Status" = $2`;
      const countResult = await query(countQuery, [userId, status]);
      const total = parseInt(countResult.rows[0].count);
      return res.status(200).json({
        success: true,
        data: {
          reports: result.rows,
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
          reports: result.rows,
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
    console.error("[Report] Get my reports error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch reports")],
    });
  }
});

// Get reports against me (as reported user)
export const getReportsAgainstMe = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const page = getQueryNumber(req.query.page, 1);
    const limit = getQueryNumber(req.query.limit, 10);
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT r.*, 
              u."FullName" as "ReporterName",
              u."Email" as "ReporterEmail",
              s."Title" as "SessionTitle"
       FROM "Report" r
       JOIN "User" u ON r."ReporterID" = u."UserID"
       LEFT JOIN "Session" s ON r."SessionID" = s."SessionID"
       WHERE r."ReportedUserID" = $1
       ORDER BY r."CreatedAt" DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) FROM "Report" WHERE "ReportedUserID" = $1`,
      [userId]
    );
    const total = parseInt(countResult.rows[0].count);

    return res.status(200).json({
      success: true,
      data: {
        reports: result.rows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("[Report] Get reports against me error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch reports")],
    });
  }
});

// ==================== ADMIN ROUTES ====================

// Get all reports (admin only)
export const getAllReports = asyncHandler(async (req: Request, res: Response) => {
  try {
    const currentUserRole = (req as any).user?.role;

    if (currentUserRole !== 'Admin') {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only admin can view all reports")],
      });
    }

    const page = getQueryNumber(req.query.page, 1);
    const limit = getQueryNumber(req.query.limit, 20);
    const offset = (page - 1) * limit;
    const status = getQueryString(req.query.status);
    const reason = getQueryString(req.query.reason);

    let queryText = `
      SELECT r.*, 
             rep."FullName" as "ReporterName",
             rep."Email" as "ReporterEmail",
             reported."FullName" as "ReportedUserName",
             reported."Email" as "ReportedUserEmail",
             s."Title" as "SessionTitle"
      FROM "Report" r
      JOIN "User" rep ON r."ReporterID" = rep."UserID"
      JOIN "User" reported ON r."ReportedUserID" = reported."UserID"
      LEFT JOIN "Session" s ON r."SessionID" = s."SessionID"
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      queryText += ` AND r."Status" = $${paramCount}`;
      params.push(status);
    }

    if (reason) {
      paramCount++;
      queryText += ` AND r."Reason" = $${paramCount}`;
      params.push(reason);
    }

    queryText += ` ORDER BY r."CreatedAt" DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM "Report" WHERE 1=1`;
    if (status) {
      countQuery += ` AND "Status" = $1`;
      const countResult = await query(countQuery, [status]);
      const total = parseInt(countResult.rows[0].count);
      return res.status(200).json({
        success: true,
        data: {
          reports: result.rows,
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
          reports: result.rows,
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
    console.error("[Report] Get all reports error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch reports")],
    });
  }
});

// Get report by ID (admin only)
export const getReportById = asyncHandler(async (req: Request, res: Response) => {
  try {
    const currentUserRole = (req as any).user?.role;

    if (currentUserRole !== 'Admin') {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only admin can view report details")],
      });
    }

    const { reportId } = req.params;

    const result = await query(
      `SELECT r.*, 
              rep."FullName" as "ReporterName",
              rep."Email" as "ReporterEmail",
              rep."ProfileImageURL" as "ReporterImage",
              reported."FullName" as "ReportedUserName",
              reported."Email" as "ReportedUserEmail",
              reported."ProfileImageURL" as "ReportedUserImage",
              s."Title" as "SessionTitle",
              s."ScheduledStart" as "SessionStart",
              s."Status" as "SessionStatus"
       FROM "Report" r
       JOIN "User" rep ON r."ReporterID" = rep."UserID"
       JOIN "User" reported ON r."ReportedUserID" = reported."UserID"
       LEFT JOIN "Session" s ON r."SessionID" = s."SessionID"
       WHERE r."ReportID" = $1`,
      [reportId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("report", "Report not found")],
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("[Report] Get by ID error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch report")],
    });
  }
});

// Resolve report (admin only)
export const resolveReport = asyncHandler(async (req: Request, res: Response) => {
  try {
    const currentUserRole = (req as any).user?.role;
    const adminId = (req as any).user?.UserID;

    if (currentUserRole !== 'Admin') {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only admin can resolve reports")],
      });
    }

    const { reportId } = req.params;
    const { status, adminNotes, action } = req.body; // action: WARNING, SUSPENSION, BAN

    if (!status || !['RESOLVED', 'DISMISSED'].includes(status)) {
      return res.status(400).json({
        success: false,
        errors: [formatError("status", "Status must be RESOLVED or DISMISSED")],
      });
    }

    // Get report details
    const reportResult = await query(
      `SELECT * FROM "Report" WHERE "ReportID" = $1`,
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("report", "Report not found")],
      });
    }

    const report = reportResult.rows[0];

    // Update report
    const result = await query(
      `UPDATE "Report" 
       SET "Status" = $1, 
           "AdminNotes" = $2, 
           "ResolvedBy" = $3, 
           "ResolvedAt" = NOW()
       WHERE "ReportID" = $4
       RETURNING *`,
      [status, adminNotes || null, adminId, reportId]
    );

    // If action is taken against reported user, create AdminAction
    if (action && ['WARNING', 'SUSPENSION', 'BAN'].includes(action)) {
      await query(
        `INSERT INTO "AdminAction" 
         ("ActionID", "AdminID", "ActionType", "TargetUserID", 
          "SessionID", "Description", "Metadata", "CreatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())`,
        [adminId, action, report.ReportedUserID, report.SessionID, 
         `${action} issued for report ${reportId}`, JSON.stringify({ reportId, adminNotes })]
      );

      // If action is BAN, update user status
      if (action === 'BAN') {
        await query(
          `UPDATE "User" 
           SET "Status" = 'Banned', "UpdatedAt" = NOW()
           WHERE "UserID" = $1`,
          [report.ReportedUserID]
        );
      } else if (action === 'SUSPENSION') {
        await query(
          `UPDATE "User" 
           SET "Status" = 'Inactive', "UpdatedAt" = NOW()
           WHERE "UserID" = $1`,
          [report.ReportedUserID]
        );
      }
    }

    // Notify reporter
    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
       VALUES (gen_random_uuid(), $1, 'REPORT_RESOLVED', $2, $3, $4, NOW())`,
      [report.ReporterID, "Report Resolved", 
       `Your report has been ${status.toLowerCase()}. Thank you for helping keep our community safe.`,
       JSON.stringify({ reportId, status, action })]
    );

    // Notify reported user if action taken
    if (action) {
      await query(
        `INSERT INTO "Notification" 
         ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
         VALUES (gen_random_uuid(), $1, 'REPORT_RESOLVED', $2, $3, $4, NOW())`,
        [report.ReportedUserID, "Action Taken", 
         `A ${action} has been issued regarding a recent report. Please contact support if you have questions.`,
         JSON.stringify({ reportId, action })]
      );
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
      message: `Report ${status.toLowerCase()} successfully`,
    });
  } catch (error) {
    console.error("[Report] Resolve error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to resolve report")],
    });
  }
});

// Get report statistics (admin only)
export const getReportStats = asyncHandler(async (req: Request, res: Response) => {
  try {
    const currentUserRole = (req as any).user?.role;

    if (currentUserRole !== 'Admin') {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only admin can view report statistics")],
      });
    }

    const statsResult = await query(`
      SELECT 
        COUNT(*) as total_reports,
        COUNT(CASE WHEN "Status" = 'PENDING' THEN 1 END) as pending,
        COUNT(CASE WHEN "Status" = 'REVIEWED' THEN 1 END) as reviewed,
        COUNT(CASE WHEN "Status" = 'RESOLVED' THEN 1 END) as resolved,
        COUNT(CASE WHEN "Status" = 'DISMISSED' THEN 1 END) as dismissed,
        COUNT(CASE WHEN "Reason" = 'INAPPROPRIATE_BEHAVIOR' THEN 1 END) as inappropriate_behavior,
        COUNT(CASE WHEN "Reason" = 'HARASSMENT' THEN 1 END) as harassment,
        COUNT(CASE WHEN "Reason" = 'NO_SHOW' THEN 1 END) as no_show,
        COUNT(CASE WHEN "Reason" = 'SPAM' THEN 1 END) as spam,
        COUNT(CASE WHEN "Reason" = 'TECHNICAL_ISSUES' THEN 1 END) as technical_issues,
        COUNT(CASE WHEN "CreatedAt" > NOW() - INTERVAL '7 days' THEN 1 END) as last_7_days,
        COUNT(CASE WHEN "CreatedAt" > NOW() - INTERVAL '30 days' THEN 1 END) as last_30_days
      FROM "Report"
    `);

    return res.status(200).json({
      success: true,
      data: statsResult.rows[0],
    });
  } catch (error) {
    console.error("[Report] Get stats error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch report statistics")],
    });
  }
});