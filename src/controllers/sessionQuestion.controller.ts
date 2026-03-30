// src/controllers/sessionQuestion.controller.ts
import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";

enum SessionStatus {
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  SCHEDULED = "SCHEDULED",
}

// Helper functions
const getQueryNumber = (param: any, defaultValue: number): number => {
  if (!param) return defaultValue;
  const num = parseInt(param, 10);
  return isNaN(num) ? defaultValue : num;
};

const getQueryBoolean = (param: any): boolean => {
  return param === 'true';
};

// Ask a question during session
export const askQuestion = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const userName = (req as any).user?.fullName;
    const { sessionId } = req.params;
    const { question } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({
        success: false,
        errors: [formatError("question", "Question is required")],
      });
    }

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

    const session = sessionCheck.rows[0];

    // Only allow questions during active or scheduled sessions
    if (session.Status !== SessionStatus.IN_PROGRESS && session.Status !== SessionStatus.SCHEDULED) {
      return res.status(400).json({
        success: false,
        errors: [formatError("session", "Questions can only be asked during active or scheduled sessions")],
      });
    }

    // Insert question
    const result = await query(
      `INSERT INTO "SessionQuestion" 
       ("QuestionID", "SessionID", "UserID", "Question", "IsAnswered", "CreatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, false, NOW())
       RETURNING *`,
      [sessionId, userId, question.trim()]
    );

    const newQuestion = result.rows[0];

    // Add user name to response
    newQuestion.askerName = userName;

    // Notify mentor if session is active
    if (session.Status === SessionStatus.IN_PROGRESS) {
      await query(
        `INSERT INTO "Notification" 
         ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
         VALUES (gen_random_uuid(), $1, 'NEW_MESSAGE', $2, $3, $4, NOW())`,
        [session.MentorID, "New Question", 
         `${userName || 'A learner'} asked a question: ${question.substring(0, 50)}...`,
         JSON.stringify({ sessionId, questionId: newQuestion.QuestionID })]
      );
    }

    return res.status(201).json({
      success: true,
      data: newQuestion,
      message: "Question submitted successfully",
    });
  } catch (error) {
    console.error("[SessionQuestion] Ask question error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to submit question: " + (error as Error).message)],
    });
  }
});

// Get questions for a session
export const getSessionQuestions = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId } = req.params;
    const answeredOnly = getQueryBoolean(req.query.answeredOnly);
    const unansweredOnly = getQueryBoolean(req.query.unansweredOnly);
    const page = getQueryNumber(req.query.page, 1);
    const limit = getQueryNumber(req.query.limit, 20);
    const offset = (page - 1) * limit;

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
      SELECT q.*, 
             u."FullName" as "askerName",
             u."ProfileImageURL" as "askerImage",
             a."FullName" as "answererName"
      FROM "SessionQuestion" q
      JOIN "User" u ON q."UserID" = u."UserID"
      LEFT JOIN "User" a ON q."AnsweredBy" = a."UserID"
      WHERE q."SessionID" = $1
    `;
    const params: any[] = [sessionId];
    let paramCount = 1;

    if (answeredOnly) {
      paramCount++;
      queryText += ` AND q."IsAnswered" = true`;
    } else if (unansweredOnly) {
      paramCount++;
      queryText += ` AND q."IsAnswered" = false`;
    }

    queryText += ` ORDER BY 
                    CASE WHEN q."IsAnswered" = false THEN 0 ELSE 1 END,
                    q."CreatedAt" ASC
                  LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM "SessionQuestion" WHERE "SessionID" = $1`;
    if (answeredOnly) {
      countQuery += ` AND "IsAnswered" = true`;
    } else if (unansweredOnly) {
      countQuery += ` AND "IsAnswered" = false`;
    }
    const countResult = await query(countQuery, [sessionId]);
    const total = parseInt(countResult.rows[0].count);

    return res.status(200).json({
      success: true,
      data: {
        questions: result.rows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
        stats: {
          total: total,
          answered: result.rows.filter(q => q.IsAnswered).length,
          unanswered: result.rows.filter(q => !q.IsAnswered).length,
        },
      },
    });
  } catch (error) {
    console.error("[SessionQuestion] Get questions error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch questions")],
    });
  }
});

// Answer a question (mentor only)
export const answerQuestion = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId, questionId } = req.params;
    const { answer } = req.body;

    if (!answer || !answer.trim()) {
      return res.status(400).json({
        success: false,
        errors: [formatError("answer", "Answer is required")],
      });
    }

    // Check if user is the mentor of this session
    const sessionCheck = await query(
      `SELECT * FROM "Session" 
       WHERE "SessionID" = $1 AND "MentorID" = $2`,
      [sessionId, userId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "Only the mentor can answer questions")],
      });
    }

    // Check if question exists and belongs to this session
    const questionCheck = await query(
      `SELECT q.*, u."FullName" as "askerName"
       FROM "SessionQuestion" q
       JOIN "User" u ON q."UserID" = u."UserID"
       WHERE q."QuestionID" = $1 AND q."SessionID" = $2`,
      [questionId, sessionId]
    );

    if (questionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("question", "Question not found")],
      });
    }

    const question = questionCheck.rows[0];

    if (question.IsAnswered) {
      return res.status(400).json({
        success: false,
        errors: [formatError("question", "Question already answered")],
      });
    }

    // Update question with answer
    const result = await query(
      `UPDATE "SessionQuestion" 
       SET "Answer" = $1, 
           "IsAnswered" = true, 
           "AnsweredBy" = $2, 
           "AnsweredAt" = NOW()
       WHERE "QuestionID" = $3
       RETURNING *`,
      [answer.trim(), userId, questionId]
    );

    const updatedQuestion = result.rows[0];
    updatedQuestion.askerName = question.askerName;

    // Notify the asker
    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
       VALUES (gen_random_uuid(), $1, 'NEW_MESSAGE', $2, $3, $4, NOW())`,
      [question.UserID, "Question Answered", 
       `Your question was answered: ${answer.substring(0, 50)}...`,
       JSON.stringify({ sessionId, questionId, answer: answer.substring(0, 100) })]
    );

    return res.status(200).json({
      success: true,
      data: updatedQuestion,
      message: "Question answered successfully",
    });
  } catch (error) {
    console.error("[SessionQuestion] Answer question error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to answer question")],
    });
  }
});

// Delete a question (asker only or mentor)
export const deleteQuestion = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const userRole = (req as any).user?.role;
    const { sessionId, questionId } = req.params;

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

    const session = sessionCheck.rows[0];
    const isMentor = session.MentorID === userId;

    // Check if question exists
    const questionCheck = await query(
      `SELECT * FROM "SessionQuestion" 
       WHERE "QuestionID" = $1 AND "SessionID" = $2`,
      [questionId, sessionId]
    );

    if (questionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("question", "Question not found")],
      });
    }

    const question = questionCheck.rows[0];

    // Only asker or mentor can delete
    if (question.UserID !== userId && !isMentor) {
      return res.status(403).json({
        success: false,
        errors: [formatError("authorization", "You can only delete your own questions")],
      });
    }

    // Delete question
    await query(
      `DELETE FROM "SessionQuestion" WHERE "QuestionID" = $1`,
      [questionId]
    );

    return res.status(200).json({
      success: true,
      message: "Question deleted successfully",
    });
  } catch (error) {
    console.error("[SessionQuestion] Delete question error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to delete question")],
    });
  }
});

// Edit a question (asker only, before answered)
export const editQuestion = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { sessionId, questionId } = req.params;
    const { question } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({
        success: false,
        errors: [formatError("question", "Question is required")],
      });
    }

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

    // Check if question exists and belongs to user
    const questionCheck = await query(
      `SELECT * FROM "SessionQuestion" 
       WHERE "QuestionID" = $1 AND "SessionID" = $2 AND "UserID" = $3`,
      [questionId, sessionId, userId]
    );

    if (questionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("question", "Question not found or you don't own it")],
      });
    }

    const existingQuestion = questionCheck.rows[0];

    if (existingQuestion.IsAnswered) {
      return res.status(400).json({
        success: false,
        errors: [formatError("question", "Cannot edit answered questions")],
      });
    }

    // Update question
    const result = await query(
      `UPDATE "SessionQuestion" 
       SET "Question" = $1
       WHERE "QuestionID" = $2
       RETURNING *`,
      [question.trim(), questionId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows[0],
      message: "Question updated successfully",
    });
  } catch (error) {
    console.error("[SessionQuestion] Edit question error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to edit question")],
    });
  }
});

// Get question statistics for a session
export const getQuestionStats = asyncHandler(async (req: Request, res: Response) => {
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
         COUNT(*) as total_questions,
         COUNT(CASE WHEN "IsAnswered" = true THEN 1 END) as answered,
         COUNT(CASE WHEN "IsAnswered" = false THEN 1 END) as unanswered,
         AVG(CASE WHEN "IsAnswered" = true THEN 
           EXTRACT(EPOCH FROM ("AnsweredAt" - "CreatedAt")) / 60 END) as avg_response_time_minutes
       FROM "SessionQuestion"
       WHERE "SessionID" = $1`,
      [sessionId]
    );

    return res.status(200).json({
      success: true,
      data: {
        totalQuestions: parseInt(result.rows[0].total_questions),
        answered: parseInt(result.rows[0].answered),
        unanswered: parseInt(result.rows[0].unanswered),
        averageResponseTime: result.rows[0].avg_response_time_minutes 
          ? parseFloat(result.rows[0].avg_response_time_minutes).toFixed(2) 
          : null,
      },
    });
  } catch (error) {
    console.error("[SessionQuestion] Get stats error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch question statistics")],
    });
  }
});