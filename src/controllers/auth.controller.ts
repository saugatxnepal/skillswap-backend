// src/controllers/auth.controller.ts
import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";
import { comparePassword, hashPassword } from "../utils/hash.util";
import { generateRefreshToken, generateToken } from "../utils/token.util";
import { RedisService } from "../utils/redis.util";
import { CacheKeys } from "../utils/cacheKeys.util";
import crypto from 'crypto';
import redisClient from "../config/redis";

enum Role {
  Learner = "Learner",
  Admin = "Admin",
}

enum UserStatus {
  Active = "Active",
  Inactive = "Inactive",
  Banned = "Banned",
}

// Register User
export const registerUser = asyncHandler(async (req: Request, res: Response) => {
  try {
    let { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        errors: [formatError("fields", "All fields are required")],
      });
    }
    
    email = email.trim().toLowerCase();
    
    await RedisService.del(CacheKeys.userByEmail(email));
    await RedisService.delPattern(`*${email}*`);
    
    // Check database
    const emailCheck = await query(
      'SELECT * FROM "User" WHERE "Email" = $1',
      [email],
    );
    
    if ((emailCheck.rowCount ?? 0) > 0) {
      return res.status(400).json({
        success: false,
        errors: [formatError("email", "Email already registered")],
      });
    }

    const passwordHash = await hashPassword(password);

    const insertUser = await query(
      `INSERT INTO "User"
        ("UserID", "FullName", "Email", "PasswordHash", "Role", "Status", "CreatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
       RETURNING "UserID", "FullName", "Email", "Role", "Status", "CreatedAt"`,
      [fullName, email, passwordHash, Role.Learner, UserStatus.Active],
    );

    const newUser = insertUser.rows[0];

    // Cache the new user
    await RedisService.setEx(CacheKeys.user(newUser.UserID), 3600, newUser);
    await RedisService.setEx(CacheKeys.userByEmail(email), 3600, newUser);
    await RedisService.setEx(CacheKeys.userProfile(newUser.UserID), 3600, newUser);

    // Clear users list cache
    await RedisService.delPattern('users:page:*');

    return res.status(201).json({
      success: true,
      data: newUser,
    });
    
  } catch (error) {
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Internal server error: " + (error as Error).message)],
    });
  }
});

// Login User
export const loginUser = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        errors: [formatError("fields", "All fields are required")],
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // ⚠️ IMPORTANT: Skip cache for login - always get fresh from DB
    console.log('Fetching fresh user data from database...');
    const userResult = await query('SELECT * FROM "User" WHERE "Email" = $1', [
      normalizedEmail,
    ]);
    
    if (!userResult.rows.length) {
      return res.status(400).json({
        success: false,
        errors: [formatError("credentials", "Invalid credentials")],
      });
    }
    
    const user = userResult.rows[0];
    console.log('User from DB, status:', user.Status);

    // Check status from FRESH database data
    if (user.Status !== UserStatus.Active) {
      return res.status(403).json({
        success: false,
        errors: [formatError("account", "Your account is inactive")],
      });
    }

    const isValid = await comparePassword(password, user.PasswordHash);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        errors: [formatError("credentials", "Invalid credentials")],
      });
    }

    // After successful login, UPDATE the cache with fresh data
    await RedisService.setEx(CacheKeys.userByEmail(normalizedEmail), 3600, user);
    await RedisService.setEx(CacheKeys.user(user.UserID), 3600, user);
    await RedisService.setEx(CacheKeys.userProfile(user.UserID), 3600, user);

    const token = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    // Store session in Redis
    const sessionKey = `session:${user.UserID}:${Date.now()}`;
    await RedisService.setEx(sessionKey, 86400, {
      token,
      loginTime: new Date().toISOString(),
      ip: req.ip,
    });

    await RedisService.setEx(
      CacheKeys.userActivity(user.UserID), 
      86400, 
      { lastLogin: new Date().toISOString(), ip: req.ip }
    );

    delete user.PasswordHash;

    return res.status(200).json({
      success: true,
      data: {
        token,
        refreshToken,
        user,
      },
    });
    
  } catch (error) {
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Internal server error: " + (error as Error).message)],
    });
  }
});

export const logoutUser = asyncHandler(async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const user = (req as any).user;

    if (token) {
      const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
      
      if (expiresIn > 0) {
        await RedisService.setEx(
          CacheKeys.blacklistedToken(token),
          expiresIn,
          { blacklisted: true }
        );
      }
    }

    if (user?.UserID) {
      await RedisService.delPattern(`session:${user.UserID}:*`);
      await RedisService.del(CacheKeys.userActivity(user.UserID));
    }

    return res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Logout failed")]
    });
  }
});

// Get Profile and Sessions are now CACHED with Redis
export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.UserID;
    
    // Try to get from cache first
    const cacheKey = CacheKeys.userProfile(userId);
    let profile = await RedisService.get(cacheKey);
    let fromCache = true;  // Assume from cache initially

    if (!profile) {
      console.log('Profile not in cache, fetching from database...');
      fromCache = false;
      
      const result = await query(
        `SELECT "UserID", "FullName", "Email", "Role", "Status", "CreatedAt"
         FROM "User" 
         WHERE "UserID" = $1`,
        [userId]
      );

      if (result.rows.length === 0) { 
        return res.status(404).json({
          success: false,
          errors: [formatError("user", "User not found")]
        });
      }

      profile = result.rows[0];
      
      // Cache for 5 minutes (300 seconds)
      await RedisService.setEx(cacheKey, 300, profile);
    } else {
      console.log('Profile found in cache!');
    }

    return res.status(200).json({
      success: true,
      data: profile,
      fromCache: fromCache
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch profile")]
    });
  }
});

export const getUserSessions = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.UserID;
    
    // Try to get from cache
    const cacheKey = CacheKeys.userSessions(userId);
    let sessions = await RedisService.get(cacheKey);

    if (!sessions) {
      console.log('Sessions not in cache, fetching from Redis...');
      
      // Get all sessions for this user from Redis
      const sessionKeys = await redisClient.keys(`session:${userId}:*`);
      const sessionData = [];
      
      for (const key of sessionKeys) {
        const session = await RedisService.get(key);
        if (session) {
          sessionData.push({
            id: key.split(':').pop(),
            ...session
          });
        }
      }
      
      sessions = sessionData;
      
      // Cache for 2 minutes (120 seconds) - sessions change frequently
      await RedisService.setEx(cacheKey, 120, sessions);
    }

    return res.status(200).json({
      success: true,
      data: sessions,
      fromCache: true
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch sessions")]
    });
  }
});

// Verify Email
export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    
    // Check if token was already used (cached blacklist)
    const blacklistKey = `verify:used:${token}`;
    const used = await RedisService.get(blacklistKey);
    
    if (used) {
      return res.status(400).json({
        success: false,
        errors: [formatError("token", "Token already used or expired")]
      });
    }

    // Verify token from database
    const result = await query(
      `SELECT "UserID", "Email" FROM "User" 
       WHERE "VerificationToken" = $1 AND "VerificationExpiry" > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        errors: [formatError("token", "Invalid or expired token")]
      });
    }

    // Update user as verified
    await query(
      `UPDATE "User" SET "EmailVerified" = true, "Status" = $1 
       WHERE "UserID" = $2`,
      [UserStatus.Active, result.rows[0].UserID]
    );

    // Cache token as used (24 hours expiry)
    await RedisService.setEx(blacklistKey, 86400, { used: true });

    // Clear user caches
    await RedisService.del(CacheKeys.user(result.rows[0].UserID));
    await RedisService.del(CacheKeys.userByEmail(result.rows[0].Email));

    return res.status(200).json({
      success: true,
      message: "Email verified successfully"
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to verify email")]
    });
  }
});

// Check Email Availability
export const checkEmailAvailability = asyncHandler(async (req: Request, res: Response) => {
  try {
    const email = Array.isArray(req.params.email) ? req.params.email[0] : req.params.email;
    const normalizedEmail = email.trim().toLowerCase();
    
    // Try cache first
    const cacheKey = `email:check:${normalizedEmail}`;
    let available = await RedisService.get(cacheKey);

    if (available === null) {
      console.log('Email check not in cache, checking database...');
      
      const result = await query(
        'SELECT "UserID" FROM "User" WHERE "Email" = $1',
        [normalizedEmail]
      );
      
      available = result.rows.length === 0;
      
      // Cache for 10 minutes (600 seconds)
      await RedisService.setEx(cacheKey, 600, available);
    }

    return res.status(200).json({
      success: true,
      data: {
        email: normalizedEmail,
        available: available
      },
      fromCache: true
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to check email")]
    });
  }
});

// Get User Activity
export const getUserActivity = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.UserID;
    
    // Try to get from cache
    const cacheKey = CacheKeys.userActivity(userId);
    let activity = await RedisService.get(cacheKey);

    if (!activity) {
      console.log('Activity not in cache, fetching...');
      
      // Get last login from sessions
      const sessions = await redisClient.keys(`session:${userId}:*`);
      const lastSession = sessions.length > 0 
        ? await RedisService.get(sessions.sort().reverse()[0])
        : null;
      
      // Get account creation from DB (cached separately)
      const userProfile = await RedisService.get(CacheKeys.userProfile(userId));
      
      activity = {
        lastLogin: lastSession?.loginTime || null,
        lastLoginIp: lastSession?.ip || null,
        accountCreated: userProfile?.CreatedAt || null,
        sessionCount: sessions.length,
        recentActivity: []
      };
      
      // Cache for 5 minutes
      await RedisService.setEx(cacheKey, 300, activity);
    }

    return res.status(200).json({
      success: true,
      data: activity,
      fromCache: true
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch activity")]
    });
  }
});