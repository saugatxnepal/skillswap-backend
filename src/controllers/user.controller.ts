import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";
import { RedisService } from "../utils/redis.util";
import { CacheKeys } from "../utils/cacheKeys.util";
import { comparePassword, hashPassword } from "../utils/hash.util";
import fs from "fs";
import path from "path";
import { Role, UserStatus } from "../constants/roles";

// Helper function to safely get string from query parameter
const getQueryString = (param: any): string | undefined => {
  if (typeof param === 'string') return param;
  if (Array.isArray(param)) return param[0];
  return undefined;
};

// Helper function to safely get number from query parameter
const getQueryNumber = (param: any, defaultValue: number): number => {
  const str = getQueryString(param);
  if (!str) return defaultValue;
  const num = parseInt(str, 10);
  return isNaN(num) ? defaultValue : num;
};

// Get base URL for serving images
const getBaseUrl = (req: Request): string => {
  return `${req.protocol}://${req.get('host')}`;
};

// Delete old profile image file
const deleteOldProfileImage = async (imageUrl: string) => {
  if (!imageUrl) return;
  
  if (imageUrl.includes('/uploads/')) {
    try {
      const urlParts = imageUrl.split('/uploads/');
      if (urlParts.length > 1) {
        const filePath = path.join(__dirname, '../../uploads', urlParts[1]);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log('Deleted old profile image:', filePath);
        }
      }
    } catch (error) {
      console.error('Error deleting old profile image:', error);
    }
  }
};

// ==================== PUBLIC/PROTECTED ROUTES ====================

// Get current user profile (from JWT token)
export const getCurrentUserProfile = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const currentUserId = (req as any).user?.UserID;

      if (!currentUserId) {
        return res.status(401).json({
          success: false,
          errors: [formatError("auth", "User not authenticated")],
        });
      }

      const cacheKey = CacheKeys.userProfile(currentUserId);
      let user = await RedisService.get(cacheKey);

      if (!user) {
        console.log("Current user profile not in cache, fetching from database...");

        const result = await query(
          `SELECT "UserID", "FullName", "Email", "Role", "Status", "Bio", 
                  "ProfileImageURL", "Timezone", "NotificationPreferences", "CreatedAt"
           FROM "User" 
           WHERE "UserID" = $1`,
          [currentUserId],
        );

        if (result.rows.length === 0) {
          return res.status(404).json({
            success: false,
            errors: [formatError("user", "User not found")],
          });
        }

        user = result.rows[0];

        // Cache for 1 hour (3600 seconds)
        await RedisService.setEx(cacheKey, 3600, user);
      }

      return res.status(200).json({
        success: true,
        data: user,
        fromCache: true,
      });
    } catch (error) {
      console.error("Get current user profile error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Update current user profile (with file upload support)
export const updateCurrentUserProfile = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const currentUserId = (req as any).user?.UserID;
      
      const { fullName, bio, timezone, notificationPreferences } = req.body;
      
      let profileImageURL = undefined;
      if (req.file) {
        profileImageURL = `/uploads/profiles/${req.file.filename}`;
      }

      if (!currentUserId) {
        return res.status(401).json({
          success: false,
          errors: [formatError("auth", "User not authenticated")],
        });
      }

      const existingUser = await query(
        `SELECT * FROM "User" WHERE "UserID" = $1`,
        [currentUserId],
      );

      if (existingUser.rows.length === 0) {
        return res.status(404).json({
          success: false,
          errors: [formatError("user", "User not found")],
        });
      }

      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 0;

      if (fullName !== undefined && fullName !== '') {
        paramCount++;
        updates.push(`"FullName" = $${paramCount}`);
        values.push(fullName);
      }

      if (bio !== undefined) {
        paramCount++;
        updates.push(`"Bio" = $${paramCount}`);
        values.push(bio || null);
      }

      if (timezone !== undefined) {
        paramCount++;
        updates.push(`"Timezone" = $${paramCount}`);
        values.push(timezone || 'UTC');
      }

      if (notificationPreferences !== undefined) {
        paramCount++;
        updates.push(`"NotificationPreferences" = $${paramCount}`);
        values.push(notificationPreferences);
      }

      if (profileImageURL !== undefined) {
        paramCount++;
        updates.push(`"ProfileImageURL" = $${paramCount}`);
        values.push(profileImageURL);
        await deleteOldProfileImage(existingUser.rows[0].ProfileImageURL);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          errors: [formatError("fields", "No fields to update")],
        });
      }

      paramCount++;
      updates.push(`"UpdatedAt" = NOW()`);
      values.push(currentUserId);

      const updateQuery = `
        UPDATE "User" 
        SET ${updates.join(', ')}
        WHERE "UserID" = $${paramCount}
        RETURNING "UserID", "FullName", "Email", "Role", "Status", "Bio", 
                  "ProfileImageURL", "Timezone", "NotificationPreferences", "CreatedAt"
      `;

      const updateResult = await query(updateQuery, values);
      const updatedUser = updateResult.rows[0];

      await RedisService.del(CacheKeys.user(currentUserId));
      await RedisService.del(CacheKeys.userProfile(currentUserId));
      await RedisService.del(CacheKeys.userByEmail(updatedUser.Email));
      await RedisService.delPattern(CacheKeys.deletePattern('users:page:*'));

      return res.status(200).json({
        success: true,
        data: updatedUser,
        message: "Profile updated successfully",
      });
    } catch (error) {
      console.error("Update current user profile error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Update user password
export const updateUserPassword = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const currentUserId = (req as any).user?.UserID;
      const { currentPassword, newPassword } = req.body;

      if (!currentUserId) {
        return res.status(401).json({
          success: false,
          errors: [formatError("auth", "User not authenticated")],
        });
      }

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          errors: [formatError("fields", "Current password and new password are required")],
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          errors: [formatError("newPassword", "Password must be at least 6 characters long")],
        });
      }

      const userResult = await query(
        `SELECT "PasswordHash" FROM "User" WHERE "UserID" = $1`,
        [currentUserId],
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          errors: [formatError("user", "User not found")],
        });
      }

      const isValid = await comparePassword(currentPassword, userResult.rows[0].PasswordHash);
      if (!isValid) {
        return res.status(400).json({
          success: false,
          errors: [formatError("currentPassword", "Current password is incorrect")],
        });
      }

      const newPasswordHash = await hashPassword(newPassword);

      await query(
        `UPDATE "User" 
         SET "PasswordHash" = $1, "UpdatedAt" = NOW()
         WHERE "UserID" = $2`,
        [newPasswordHash, currentUserId],
      );

      await RedisService.del(CacheKeys.user(currentUserId));
      await RedisService.del(CacheKeys.userProfile(currentUserId));
      await RedisService.delPattern(`session:${currentUserId}:*`);

      return res.status(200).json({
        success: true,
        message: "Password updated successfully. Please login again.",
      });
    } catch (error) {
      console.error("Update password error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Update notification preferences
export const updateNotificationPreferences = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const currentUserId = (req as any).user?.UserID;
      const { email, inApp } = req.body;

      if (!currentUserId) {
        return res.status(401).json({
          success: false,
          errors: [formatError("auth", "User not authenticated")],
        });
      }

      const preferences = {
        email: email !== undefined ? email : true,
        inApp: inApp !== undefined ? inApp : true,
      };

      const result = await query(
        `UPDATE "User" 
         SET "NotificationPreferences" = $1, "UpdatedAt" = NOW()
         WHERE "UserID" = $2
         RETURNING "NotificationPreferences"`,
        [preferences, currentUserId],
      );

      await RedisService.del(CacheKeys.userProfile(currentUserId));

      return res.status(200).json({
        success: true,
        data: result.rows[0].NotificationPreferences,
        message: "Notification preferences updated",
      });
    } catch (error) {
      console.error("Update notification preferences error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// ==================== ADMIN ROUTES ====================

// Get all users (Admin only)
export const getAllUsers = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const currentUserRole = (req as any).user?.role;

      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can view all users")],
        });
      }

      const page = getQueryNumber(req.query.page, 1);
      const limit = getQueryNumber(req.query.limit, 10);
      const offset = (page - 1) * limit;
      const search = getQueryString(req.query.search);
      const role = getQueryString(req.query.role);
      const status = getQueryString(req.query.status);

      const cacheKey = CacheKeys.users(page, limit);
      let cachedData = await RedisService.get(cacheKey);

      if (cachedData) {
        return res.status(200).json({
          success: true,
          data: cachedData,
          fromCache: true,
        });
      }

      console.log("Users not in cache, fetching from database...");

      let queryText = `
        SELECT "UserID", "FullName", "Email", "Role", "Status", "Bio", 
               "ProfileImageURL", "Timezone", "CreatedAt"
        FROM "User"
        WHERE 1=1
      `;
      const queryParams: any[] = [];
      let paramCount = 0;

      if (search) {
        paramCount++;
        queryText += ` AND ("FullName" ILIKE $${paramCount} OR "Email" ILIKE $${paramCount})`;
        queryParams.push(`%${search}%`);
      }

      if (role) {
        paramCount++;
        queryText += ` AND "Role" = $${paramCount}`;
        queryParams.push(role);
      }

      if (status) {
        paramCount++;
        queryText += ` AND "Status" = $${paramCount}`;
        queryParams.push(status);
      }

      let countQuery = `SELECT COUNT(*) FROM "User" WHERE 1=1`;
      const countParams: any[] = [];
      
      if (search) {
        countQuery += ` AND ("FullName" ILIKE $1 OR "Email" ILIKE $1)`;
        countParams.push(`%${search}%`);
      }
      
      if (role) {
        countQuery += ` AND "Role" = $${countParams.length + 1}`;
        countParams.push(role);
      }
      
      if (status) {
        countQuery += ` AND "Status" = $${countParams.length + 1}`;
        countParams.push(status);
      }
      
      const countResult = await query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].count);

      queryText += ` ORDER BY "CreatedAt" DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      queryParams.push(limit, offset);

      const result = await query(queryText, queryParams);

      const response = {
        users: result.rows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };

      await RedisService.setEx(cacheKey, 300, response);

      return res.status(200).json({
        success: true,
        data: response,
        fromCache: false,
      });
    } catch (error) {
      console.error("Get all users error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Get user by ID (Admin only or own profile)
export const getUserById = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const idParam = req.params.id;
      const targetUserId = Array.isArray(idParam) ? idParam[0] : idParam;
      const currentUserId = (req as any).user?.UserID;
      const currentUserRole = (req as any).user?.role;

      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          errors: [formatError("id", "User ID is required")],
        });
      }

      if (currentUserRole !== Role.Admin && currentUserId !== targetUserId) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "You can only view your own profile")],
        });
      }

      const cacheKey = CacheKeys.user(targetUserId);
      let user = await RedisService.get(cacheKey);

      if (!user) {
        console.log("User not in cache, fetching from database...");

        const result = await query(
          `SELECT "UserID", "FullName", "Email", "Role", "Status", "Bio", 
                  "ProfileImageURL", "Timezone", "NotificationPreferences", "CreatedAt"
           FROM "User" 
           WHERE "UserID" = $1`,
          [targetUserId],
        );

        if (result.rows.length === 0) {
          return res.status(404).json({
            success: false,
            errors: [formatError("user", "User not found")],
          });
        }

        user = result.rows[0];

        await RedisService.setEx(cacheKey, 3600, user);
      }

      return res.status(200).json({
        success: true,
        data: user,
        fromCache: true,
      });
    } catch (error) {
      console.error("Get user by ID error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Update user profile by ID (Admin only)
export const updateUserProfileById = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const idParam = req.params.id;
      const targetUserId = Array.isArray(idParam) ? idParam[0] : idParam;
      const currentUserRole = (req as any).user?.role;

      const { fullName, bio, timezone, status, notificationPreferences } = req.body;
      
      let profileImageURL = undefined;
      if (req.file) {
        profileImageURL = `/uploads/profiles/${req.file.filename}`;
      }

      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          errors: [formatError("id", "User ID is required")],
        });
      }

      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can update other users' profiles")],
        });
      }

      const existingUser = await query(
        `SELECT * FROM "User" WHERE "UserID" = $1`,
        [targetUserId],
      );

      if (existingUser.rows.length === 0) {
        return res.status(404).json({
          success: false,
          errors: [formatError("user", "User not found")],
        });
      }

      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 0;

      if (fullName !== undefined && fullName !== '') {
        paramCount++;
        updates.push(`"FullName" = $${paramCount}`);
        values.push(fullName);
      }

      if (bio !== undefined) {
        paramCount++;
        updates.push(`"Bio" = $${paramCount}`);
        values.push(bio || null);
      }

      if (timezone !== undefined) {
        paramCount++;
        updates.push(`"Timezone" = $${paramCount}`);
        values.push(timezone);
      }

      if (status !== undefined && Object.values(UserStatus).includes(status)) {
        paramCount++;
        updates.push(`"Status" = $${paramCount}`);
        values.push(status);
      }

      if (notificationPreferences !== undefined) {
        paramCount++;
        updates.push(`"NotificationPreferences" = $${paramCount}`);
        values.push(notificationPreferences);
      }

      if (profileImageURL !== undefined) {
        paramCount++;
        updates.push(`"ProfileImageURL" = $${paramCount}`);
        values.push(profileImageURL);
        await deleteOldProfileImage(existingUser.rows[0].ProfileImageURL);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          errors: [formatError("fields", "No fields to update")],
        });
      }

      paramCount++;
      updates.push(`"UpdatedAt" = NOW()`);
      values.push(targetUserId);

      const updateQuery = `
        UPDATE "User" 
        SET ${updates.join(', ')}
        WHERE "UserID" = $${paramCount}
        RETURNING "UserID", "FullName", "Email", "Role", "Status", "Bio", 
                  "ProfileImageURL", "Timezone", "NotificationPreferences", "CreatedAt"
      `;

      const updateResult = await query(updateQuery, values);
      const updatedUser = updateResult.rows[0];

      await RedisService.del(CacheKeys.user(targetUserId));
      await RedisService.del(CacheKeys.userProfile(targetUserId));
      await RedisService.del(CacheKeys.userByEmail(updatedUser.Email));
      await RedisService.delPattern(CacheKeys.deletePattern('users:page:*'));

      return res.status(200).json({
        success: true,
        data: updatedUser,
        message: "Profile updated successfully",
      });
    } catch (error) {
      console.error("Update user profile by ID error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Update user role (Admin only)
export const updateUserRole = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const idParam = req.params.id;
      const targetUserId = Array.isArray(idParam) ? idParam[0] : idParam;
      const currentUserRole = (req as any).user?.role;
      const { role } = req.body;

      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          errors: [formatError("id", "User ID is required")],
        });
      }

      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can update user roles")],
        });
      }

      if (!role || !Object.values(Role).includes(role)) {
        return res.status(400).json({
          success: false,
          errors: [formatError("role", "Invalid role. Must be Admin, Mentor, or Learner")],
        });
      }

      const existingUser = await query(
        `SELECT * FROM "User" WHERE "UserID" = $1`,
        [targetUserId],
      );

      if (existingUser.rows.length === 0) {
        return res.status(404).json({
          success: false,
          errors: [formatError("user", "User not found")],
        });
      }

      if (targetUserId === (req as any).user?.UserID) {
        return res.status(400).json({
          success: false,
          errors: [formatError("role", "You cannot change your own role")],
        });
      }

      const updateResult = await query(
        `UPDATE "User" 
         SET "Role" = $1, "UpdatedAt" = NOW()
         WHERE "UserID" = $2
         RETURNING "UserID", "FullName", "Email", "Role", "Status"`,
        [role, targetUserId],
      );

      const updatedUser = updateResult.rows[0];

      await RedisService.del(CacheKeys.user(targetUserId));
      await RedisService.del(CacheKeys.userProfile(targetUserId));
      await RedisService.del(CacheKeys.userByEmail(updatedUser.Email));
      await RedisService.delPattern(CacheKeys.deletePattern('users:page:*'));

      return res.status(200).json({
        success: true,
        data: updatedUser,
        message: "User role updated successfully",
      });
    } catch (error) {
      console.error("Update user role error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Update user status (Admin only)
export const updateUserStatus = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const idParam = req.params.id;
      const targetUserId = Array.isArray(idParam) ? idParam[0] : idParam;
      const currentUserRole = (req as any).user?.role;
      const { status } = req.body;

      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          errors: [formatError("id", "User ID is required")],
        });
      }

      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can update user status")],
        });
      }

      if (!status || !Object.values(UserStatus).includes(status)) {
        return res.status(400).json({
          success: false,
          errors: [formatError("status", "Invalid status. Must be Active, Inactive, or Banned")],
        });
      }

      const existingUser = await query(
        `SELECT * FROM "User" WHERE "UserID" = $1`,
        [targetUserId],
      );

      if (existingUser.rows.length === 0) {
        return res.status(404).json({
          success: false,
          errors: [formatError("user", "User not found")],
        });
      }

      if (targetUserId === (req as any).user?.UserID) {
        return res.status(400).json({
          success: false,
          errors: [formatError("status", "You cannot change your own status")],
        });
      }

      const updateResult = await query(
        `UPDATE "User" 
         SET "Status" = $1, "UpdatedAt" = NOW()
         WHERE "UserID" = $2
         RETURNING "UserID", "FullName", "Email", "Role", "Status"`,
        [status, targetUserId],
      );

      const updatedUser = updateResult.rows[0];

      await RedisService.del(CacheKeys.user(targetUserId));
      await RedisService.del(CacheKeys.userProfile(targetUserId));
      await RedisService.del(CacheKeys.userByEmail(updatedUser.Email));
      await RedisService.delPattern(CacheKeys.deletePattern('users:page:*'));

      return res.status(200).json({
        success: true,
        data: updatedUser,
        message: `User status updated to ${status}`,
      });
    } catch (error) {
      console.error("Update user status error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Delete user (Admin only)
export const deleteUser = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const idParam = req.params.id;
      const targetUserId = Array.isArray(idParam) ? idParam[0] : idParam;
      const currentUserRole = (req as any).user?.role;

      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          errors: [formatError("id", "User ID is required")],
        });
      }

      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can delete users")],
        });
      }

      const existingUser = await query(
        `SELECT * FROM "User" WHERE "UserID" = $1`,
        [targetUserId],
      );

      if (existingUser.rows.length === 0) {
        return res.status(404).json({
          success: false,
          errors: [formatError("user", "User not found")],
        });
      }

      if (targetUserId === (req as any).user?.UserID) {
        return res.status(400).json({
          success: false,
          errors: [formatError("user", "You cannot delete your own account")],
        });
      }

      const userEmail = existingUser.rows[0].Email;
      const profileImageUrl = existingUser.rows[0].ProfileImageURL;

      await deleteOldProfileImage(profileImageUrl);

      await query(
        `DELETE FROM "User" WHERE "UserID" = $1`,
        [targetUserId],
      );

      await RedisService.del(CacheKeys.user(targetUserId));
      await RedisService.del(CacheKeys.userProfile(targetUserId));
      await RedisService.del(CacheKeys.userByEmail(userEmail));
      await RedisService.del(CacheKeys.userSessions(targetUserId));
      await RedisService.del(CacheKeys.userActivity(targetUserId));
      await RedisService.delPattern(CacheKeys.deletePattern('users:page:*'));

      return res.status(200).json({
        success: true,
        message: "User deleted successfully",
      });
    } catch (error) {
      console.error("Delete user error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);

// Get user statistics (Admin only)
export const getUserStats = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const currentUserRole = (req as any).user?.role;

      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can view user statistics")],
        });
      }

      const cacheKey = 'user:stats';
      let stats = await RedisService.get(cacheKey);

      if (!stats) {
        console.log("User stats not in cache, fetching from database...");

        const statsResult = await query(`
          SELECT 
            COUNT(*) as total_users,
            COUNT(CASE WHEN "Role" = 'Admin' THEN 1 END) as total_admins,
            COUNT(CASE WHEN "Role" = 'Mentor' THEN 1 END) as total_mentors,
            COUNT(CASE WHEN "Role" = 'Learner' THEN 1 END) as total_learners,
            COUNT(CASE WHEN "Status" = 'Active' THEN 1 END) as active_users,
            COUNT(CASE WHEN "Status" = 'Inactive' THEN 1 END) as inactive_users,
            COUNT(CASE WHEN "Status" = 'Banned' THEN 1 END) as banned_users,
            COUNT(CASE WHEN "CreatedAt" > NOW() - INTERVAL '7 days' THEN 1 END) as new_users_week,
            COUNT(CASE WHEN "CreatedAt" > NOW() - INTERVAL '30 days' THEN 1 END) as new_users_month
          FROM "User"
        `);

        stats = statsResult.rows[0] || {
          total_users: 0,
          total_admins: 0,
          total_mentors: 0,
          total_learners: 0,
          active_users: 0,
          inactive_users: 0,
          banned_users: 0,
          new_users_week: 0,
          new_users_month: 0,
        };

        await RedisService.setEx(cacheKey, 3600, stats);
      }

      return res.status(200).json({
        success: true,
        data: stats,
        fromCache: true,
      });
    } catch (error) {
      console.error("Get user stats error:", error);
      return res.status(500).json({
        success: false,
        errors: [
          formatError(
            "server",
            "Internal server error: " + (error as Error).message,
          ),
        ],
      });
    }
  },
);