import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto"; // built-in in Node 18+

export const logger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = randomUUID(); // Unique ID for tracing

  res.on("finish", () => {
    const duration = Date.now() - start;

    const log = [
      `[${new Date().toISOString()}]`,
    //   `ID: ${requestId}`,
      `${req.method} ${req.protocol.toUpperCase()} ${req.originalUrl}`,
      `Status: ${res.statusCode} ${res.statusMessage || ""}`,
    //   `HTTP/${req.httpVersion}`,
      `IP: ${req.ip || req.headers["x-forwarded-for"] || "Unknown"}`,
      `User-Agent: ${req.headers["user-agent"] || "Unknown"}`,
    //   `Referer: ${req.headers["referer"] || "None"}`,
    //   `Query: ${Object.keys(req.query).length ? JSON.stringify(req.query) : "None"}`,
    //   `Content-Length: ${res.getHeader("content-length") || "0"}`,
      `Duration: ${duration}ms`
    ].join(" | ");

    console.log(log);
  });

  next();
};
