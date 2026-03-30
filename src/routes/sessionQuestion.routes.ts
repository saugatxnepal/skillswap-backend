// src/routes/sessionQuestion.routes.ts
import { Router } from "express";
import { authenticateJWT } from "../middlewares/auth.middleware";
import {
  askQuestion,
  getSessionQuestions,
  answerQuestion,
  deleteQuestion,
  editQuestion,
  getQuestionStats,
} from "../controllers/sessionQuestion.controller";

const router = Router();

// All session question routes require authentication
router.use(authenticateJWT);

// Ask a question
router.post("/sessions/:sessionId/questions", askQuestion);

// Get questions for a session
router.get("/sessions/:sessionId/questions", getSessionQuestions);

// Get question statistics for a session
router.get("/sessions/:sessionId/questions/stats", getQuestionStats);

// Answer a question (mentor only)
router.post("/sessions/:sessionId/questions/:questionId/answer", answerQuestion);

// Edit a question (asker only, before answered)
router.put("/sessions/:sessionId/questions/:questionId", editQuestion);
router.patch("/sessions/:sessionId/questions/:questionId", editQuestion);

// Delete a question
router.delete("/sessions/:sessionId/questions/:questionId", deleteQuestion);

export default router;