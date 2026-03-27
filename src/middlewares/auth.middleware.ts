// src/middlewares/auth.middleware.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env";
import { query } from "../db";
import { TokenBlacklist } from "../utils/tokenBlacklist.util";
import { UserStatus } from "../constants/roles";

interface JwtPayload {
  id: string;
  role: string;
  email?: string;
  iat?: number;
  exp?: number;
}

export const authenticateJWT = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized access" });
  }

  const token = authHeader.split(" ")[1];

  try {
    // Check if token is blacklisted
    const isBlacklisted = await TokenBlacklist.isTokenBlacklisted(token);
    if (isBlacklisted) {
      return res.status(401).json({ message: "Token has been revoked" });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    console.log(`[Auth] Token decoded for user ID: ${decoded.id}, role: ${decoded.role}`);

    // Check if user is globally blacklisted (logout from all devices)
    const isUserBlacklisted = await TokenBlacklist.isUserBlacklisted(decoded.id);
    if (isUserBlacklisted) {
      return res.status(401).json({ message: "User session revoked" });
    }

    // Always fetch fresh user data from DB
    const userResult = await query(
      `SELECT "UserID", "Role", "Email", "Status", "FullName" FROM "User" WHERE "UserID" = $1`,
      [decoded.id]
    );

    if (userResult.rowCount === 0) {
      console.log(`[Auth] User ${decoded.id} not found in database`);
      return res.status(401).json({ message: "User not found" });
    }

    const dbUser = userResult.rows[0];

    console.log(`[Auth] DB user: ${dbUser.UserID}, role: ${dbUser.Role}, status: ${dbUser.Status}`);

    if (dbUser.Status !== UserStatus.Active) {
      console.log(`[Auth] User ${dbUser.UserID} is inactive`);
      return res.status(401).json({ message: "Your account is inactive" });
    }

    // Verify role matches
    if (dbUser.Role !== decoded.role) {
      console.log(`[Auth] ROLE MISMATCH! Token: ${decoded.role}, DB: ${dbUser.Role}`);
      const expiresIn = decoded.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 3600;
      if (expiresIn > 0) {
        await TokenBlacklist.blacklistToken(token, expiresIn);
      }
      return res.status(401).json({ message: "Invalid token: role mismatch. Please login again." });
    }

    // Verify email matches
    if (dbUser.Email !== decoded.email) {
      console.log(`[Auth] EMAIL MISMATCH! Token: ${decoded.email}, DB: ${dbUser.Email}`);
      return res.status(401).json({ message: "Invalid token: email mismatch" });
    }

    (req as any).user = {
      UserID: dbUser.UserID,
      role: dbUser.Role,
      email: dbUser.Email,
      fullName: dbUser.FullName,
    };

    console.log(`[Auth] Authenticated user: ${dbUser.UserID} as ${dbUser.Role}`);
    next();
  } catch (err) {
    console.log("[Auth] JWT ERROR:", err);
    return res.status(401).json({ message: "Invalid token" });
  }
};

// Role-based authorization
export const authorizeRoles = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ message: "Forbidden access" });
    }
    next();
  };
};
