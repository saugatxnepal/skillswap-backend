// src/routes/review.routes.ts
import { Router } from "express";
import { authenticateJWT } from "../middlewares/auth.middleware";
import {
  submitReview,
  getUserReviews,
  getMyReviews,
  updateReview,
  deleteReview,
  getReviewStats,
} from "../controllers/review.controller";

const router = Router();

// ==================== PUBLIC ROUTES ====================
// Get reviews for a specific user (public)
router.get("/users/:userId", getUserReviews);

// Get review statistics for a user (public)
router.get("/users/:userId/stats", getReviewStats);

// ==================== PROTECTED ROUTES ====================
router.use(authenticateJWT);

// Submit a review for a completed session
router.post("/sessions/:sessionId/reviews", submitReview);

// Get my reviews (reviews I received)
router.get("/my-reviews", getMyReviews);

// Update or delete my review
router.put("/reviews/:reviewId", updateReview);
router.patch("/reviews/:reviewId", updateReview);
router.delete("/reviews/:reviewId", deleteReview);

export default router;