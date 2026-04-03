import express from "express";
import cors from "cors";
import path from "path";
import authRoutes from "./routes/auth.route";
import userRoutes from "./routes/user.route";
import learnerRoutes from "./routes/learner.routes";
import mentorRoutes from "./routes/mentor.routes";
import sessionRoutes from "./routes/session.routes";
import skillCategoryRoutes from "./routes/skillCategory.route";
import reviewRoutes from "./routes/review.routes";
import notificationRoutes from "./routes/notification.routes";
import reportRoutes from "./routes/report.routes";
import sessionQuestionRoutes from "./routes/sessionQuestion.routes";
import sessionInviteRoutes from "./routes/sessionInvite.routes";
import adminDashboardRoutes from "./routes/adminDashboard.routes";
import chatRoutes from "./routes/chat.routes";
import websocketRoutes from "./routes/websocket.routes"; // Add this
import { FRONTEND_URL } from "./config/env";
import { errorHandler } from "./middlewares/errorHandler";
import { logger } from "./middlewares/logger";

const app = express();

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Logger
app.use(logger);

// Static files for uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ==================== API Routes ====================
app.use("/api/auth", authRoutes);
app.use("/api/skill-categories", skillCategoryRoutes);
app.use("/api/users", userRoutes);
app.use("/api/learner", learnerRoutes);
app.use("/api/mentor", mentorRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/session-questions", sessionQuestionRoutes);
app.use("/api/session-invites", sessionInviteRoutes);
app.use("/api/admin", adminDashboardRoutes);
app.use("/api/websocket", websocketRoutes);
app.use("/api/chat", chatRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({ 
    message: "Welcome to the SkillSwap API",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
      users: "/api/users",
      mentors: "/api/mentor",
      learners: "/api/learner",
      sessions: "/api/sessions",
      reviews: "/api/reviews",
      notifications: "/api/notifications",
      reports: "/api/reports",
      websocket: "/api/websocket"
    }
  });
});

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// Error handler (should be last)
app.use(errorHandler);

export default app;