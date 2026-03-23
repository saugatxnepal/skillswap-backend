import express from "express";
import cors from "cors";
import path from "path";
import authRoutes from "./routes/auth.route";
import userRoutes from "./routes/user.route";
import learnerRoutes from "./routes/learner.routes";
import mentorRoutes from "./routes/mentor.routes";
import sessionRoutes from "./routes/session.routes";
import skillCategoryRoutes from "./routes/skillCategory.route";
import { FRONTEND_URL } from "./config/env";
import { errorHandler } from "./middlewares/errorHandler";
import { logger } from "./middlewares/logger";

const app = express();

app.use(express.json());

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(logger);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/skill-categories", skillCategoryRoutes);
app.use("/api/users", userRoutes);
app.use("/api/learner", learnerRoutes);
app.use("/api/mentor", mentorRoutes);
app.use("/api/sessions", sessionRoutes);

// Serve uploads folder as static
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.json({ message: "Welcome to the SkillSwap API" });
});

// Error handler
app.use(errorHandler);

export default app;
