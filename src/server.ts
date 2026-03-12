// src/server.ts
import app from "./app";
import { PORT } from "./config/env";
import { connectRedis } from "./config/redis";

const startServer = async () => {
  try {
    // Try to connect to Redis, but don't fail if it doesn't work
    await connectRedis();
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// Remove the duplicate connectRedis call
startServer();