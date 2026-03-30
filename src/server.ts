// src/server.ts
import app from "./app";
import http from "http";
import { PORT } from "./config/env";
import { setupSocket } from './socket/socket';

const startServer = async () => {
  try {
    // Create HTTP server from Express app
    const server = http.createServer(app);
    
    // Setup Socket.IO for real-time features
    const io = setupSocket(server);
    
    // Make io available to controllers if needed
    app.set('io', io);
    
    // Start server
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`WebSocket server ready on ws://localhost:${PORT}`);
    });
    
    // Graceful shutdown
    const gracefulShutdown = () => {
      console.log('Received shutdown signal, closing server...');
      server.close(() => {
        console.log('Server closed successfully');
        process.exit(0);
      });
      
      // Force close after 10 seconds if server doesn't close
      setTimeout(() => {
        console.error('Could not close connections, forcefully shutting down');
        process.exit(1);
      }, 10000);
    };
    
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();