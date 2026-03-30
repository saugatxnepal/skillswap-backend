// src/controllers/review.controller.ts
import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";

enum SessionStatus {
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

// Helper functions
const getQueryNumber = (param: any, defaultValue: number): number => {
  if (!param) return defaultValue;
  const num = parseInt(param, 10);
  return isNaN(num) ? defaultValue : num;
};

// Submit a review for a session
export const submitReview = asyncHandler(async (req: Request, res: Response) => {
  try {
    const reviewerId = (req as any).user?.UserID;
    const { sessionId } = req.params;
    const { rating, comment, tags, isPublic = true } = req.body;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        errors: [formatError("rating", "Rating must be between 1 and 5")],
      });
    }

    // Check if session exists and is completed
    const sessionCheck = await query(
      `SELECT * FROM "Session" 
       WHERE "SessionID" = $1 AND "Status" = 'COMPLETED'
       AND ("MentorID" = $2 OR "LearnerID" = $2)`,
      [sessionId, reviewerId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("session", "Completed session not found")],
      });
    }

    const session = sessionCheck.rows[0];
    
    // Determine if reviewing mentor or learner
    const isMentorReview = session.MentorID === reviewerId;
    const revieweeId = isMentorReview ? session.LearnerID : session.MentorID;

    // Check if review already exists
    const existingReview = await query(
      `SELECT * FROM "Review" 
       WHERE "SessionID" = $1 AND "ReviewerID" = $2`,
      [sessionId, reviewerId]
    );

    if (existingReview.rows.length > 0) {
      return res.status(400).json({
        success: false,
        errors: [formatError("review", "You have already reviewed this session")],
      });
    }

    // Insert review
    const result = await query(
      `INSERT INTO "Review" 
       ("ReviewID", "SessionID", "ReviewerID", "RevieweeID", "Rating", 
        "Comment", "IsMentorReview", "Tags", "IsPublic", "CreatedAt", "UpdatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING *`,
      [sessionId, reviewerId, revieweeId, rating, comment || null, 
       isMentorReview, tags || [], isPublic]
    );

    const newReview = result.rows[0];

    // Create notification for reviewee
    await query(
      `INSERT INTO "Notification" 
       ("NotificationID", "UserID", "Type", "Title", "Content", "Data", "CreatedAt")
       VALUES (gen_random_uuid(), $1, 'REVIEW_RECEIVED', $2, $3, $4, NOW())`,
      [revieweeId, "New Review Received", 
       `You received a ${rating}-star review for your session`,
       JSON.stringify({ sessionId, rating, reviewId: newReview.ReviewID })]
    );

    return res.status(201).json({
      success: true,
      data: newReview,
      message: "Review submitted successfully",
    });
  } catch (error) {
    console.error("[Review] Submit error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to submit review: " + (error as Error).message)],
    });
  }
});

// Get reviews for a specific user (public)
export const getUserReviews = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const page = getQueryNumber(req.query.page, 1);
    const limit = getQueryNumber(req.query.limit, 10);
    const offset = (page - 1) * limit;

    // Get reviews with reviewer details
    const result = await query(
      `SELECT r.*, 
              u."FullName" as "ReviewerName", 
              u."ProfileImageURL" as "ReviewerImage",
              s."Title" as "SessionTitle"
       FROM "Review" r
       JOIN "User" u ON r."ReviewerID" = u."UserID"
       JOIN "Session" s ON r."SessionID" = s."SessionID"
       WHERE r."RevieweeID" = $1 AND r."IsPublic" = true
       ORDER BY r."CreatedAt" DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM "Review" WHERE "RevieweeID" = $1 AND "IsPublic" = true`,
      [userId]
    );
    const total = parseInt(countResult.rows[0].count);

    // Calculate average rating
    const avgResult = await query(
      `SELECT COALESCE(AVG("Rating"), 0) as avgRating, 
              COUNT(*) as totalReviews
       FROM "Review" 
       WHERE "RevieweeID" = $1 AND "IsPublic" = true`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      data: {
        reviews: result.rows,
        stats: {
          averageRating: parseFloat(avgResult.rows[0].avgrating),
          totalReviews: parseInt(avgResult.rows[0].totalreviews),
        },
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("[Review] Get user reviews error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch reviews")],
    });
  }
});

// Get my reviews (as reviewee - authenticated user)
export const getMyReviews = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const page = getQueryNumber(req.query.page, 1);
    const limit = getQueryNumber(req.query.limit, 10);
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT r.*, 
              u."FullName" as "ReviewerName", 
              u."ProfileImageURL" as "ReviewerImage",
              s."Title" as "SessionTitle"
       FROM "Review" r
       JOIN "User" u ON r."ReviewerID" = u."UserID"
       JOIN "Session" s ON r."SessionID" = s."SessionID"
       WHERE r."RevieweeID" = $1
       ORDER BY r."CreatedAt" DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) FROM "Review" WHERE "RevieweeID" = $1`,
      [userId]
    );
    const total = parseInt(countResult.rows[0].count);

    // Calculate stats
    const statsResult = await query(
      `SELECT 
         COALESCE(AVG("Rating"), 0) as avgRating,
         COUNT(*) as totalReviews,
         COUNT(CASE WHEN "Rating" = 5 THEN 1 END) as fiveStar,
         COUNT(CASE WHEN "Rating" = 4 THEN 1 END) as fourStar,
         COUNT(CASE WHEN "Rating" = 3 THEN 1 END) as threeStar,
         COUNT(CASE WHEN "Rating" = 2 THEN 1 END) as twoStar,
         COUNT(CASE WHEN "Rating" = 1 THEN 1 END) as oneStar
       FROM "Review" 
       WHERE "RevieweeID" = $1`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      data: {
        reviews: result.rows,
        stats: {
          averageRating: parseFloat(statsResult.rows[0].avgrating),
          totalReviews: parseInt(statsResult.rows[0].totalreviews),
          distribution: {
            5: parseInt(statsResult.rows[0].fivestar),
            4: parseInt(statsResult.rows[0].fourstar),
            3: parseInt(statsResult.rows[0].threestar),
            2: parseInt(statsResult.rows[0].twostar),
            1: parseInt(statsResult.rows[0].onestar),
          },
        },
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("[Review] Get my reviews error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch reviews")],
    });
  }
});

// Update review (only within 24 hours)
export const updateReview = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { reviewId } = req.params;
    const { rating, comment, tags, isPublic } = req.body;

    // Check if review exists and user is the reviewer
    const reviewCheck = await query(
      `SELECT * FROM "Review" 
       WHERE "ReviewID" = $1 AND "ReviewerID" = $2
       AND "CreatedAt" > NOW() - INTERVAL '24 hours'`,
      [reviewId, userId]
    );

    if (reviewCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("review", "Review not found or cannot be edited after 24 hours")],
      });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (rating !== undefined) {
      if (rating < 1 || rating > 5) {
        return res.status(400).json({
          success: false,
          errors: [formatError("rating", "Rating must be between 1 and 5")],
        });
      }
      updates.push(`"Rating" = $${paramCount++}`);
      values.push(rating);
    }
    
    if (comment !== undefined) {
      updates.push(`"Comment" = $${paramCount++}`);
      values.push(comment);
    }
    
    if (tags !== undefined) {
      updates.push(`"Tags" = $${paramCount++}`);
      values.push(tags);
    }
    
    if (isPublic !== undefined) {
      updates.push(`"IsPublic" = $${paramCount++}`);
      values.push(isPublic);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        errors: [formatError("fields", "No fields to update")],
      });
    }

    updates.push(`"UpdatedAt" = NOW()`);
    values.push(reviewId);

    const result = await query(
      `UPDATE "Review" 
       SET ${updates.join(', ')}
       WHERE "ReviewID" = $${paramCount}
       RETURNING *`,
      values
    );

    return res.status(200).json({
      success: true,
      data: result.rows[0],
      message: "Review updated successfully",
    });
  } catch (error) {
    console.error("[Review] Update error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to update review")],
    });
  }
});

// Delete review
export const deleteReview = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.UserID;
    const { reviewId } = req.params;

    const result = await query(
      `DELETE FROM "Review" 
       WHERE "ReviewID" = $1 AND "ReviewerID" = $2
       RETURNING "RevieweeID"`,
      [reviewId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("review", "Review not found")],
      });
    }

    return res.status(200).json({
      success: true,
      message: "Review deleted successfully",
    });
  } catch (error) {
    console.error("[Review] Delete error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to delete review")],
    });
  }
});

// Get review statistics for a user (public)
export const getReviewStats = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const result = await query(
      `SELECT 
         COALESCE(AVG("Rating"), 0) as averageRating,
         COUNT(*) as totalReviews,
         COUNT(CASE WHEN "Rating" = 5 THEN 1 END) as fiveStar,
         COUNT(CASE WHEN "Rating" = 4 THEN 1 END) as fourStar,
         COUNT(CASE WHEN "Rating" = 3 THEN 1 END) as threeStar,
         COUNT(CASE WHEN "Rating" = 2 THEN 1 END) as twoStar,
         COUNT(CASE WHEN "Rating" = 1 THEN 1 END) as oneStar
       FROM "Review" 
       WHERE "RevieweeID" = $1 AND "IsPublic" = true`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      data: {
        averageRating: parseFloat(result.rows[0].averagerating),
        totalReviews: parseInt(result.rows[0].totalreviews),
        distribution: {
          5: parseInt(result.rows[0].fivestar),
          4: parseInt(result.rows[0].fourstar),
          3: parseInt(result.rows[0].threestar),
          2: parseInt(result.rows[0].twostar),
          1: parseInt(result.rows[0].onestar),
        },
      },
    });
  } catch (error) {
    console.error("[Review] Get stats error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch review statistics")],
    });
  }
});