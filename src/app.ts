import express from "express";
import cors from "cors";
import path from "path";
import authRoutes from "./routes/auth.route";
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
// app.use(logger);

app.use("/api/auth", authRoutes);

// Serve uploads folder as static
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.json({ message: "Welcome to the SkillSwap API" });
});

// Error handler
app.use(errorHandler);

export default app;
