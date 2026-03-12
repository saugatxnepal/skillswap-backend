import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";
import { RedisService } from "../utils/redis.util";
import { CacheKeys } from "../utils/cacheKeys.util";
import { comparePassword, hashPassword } from "../utils/hash.util";
import fs from "fs";
import path from "path";

enum Role {
  Admin = "Admin",
  Mentor = "Mentor",
  Learner = "Learner",
}

enum UserStatus {
  Active = "Active",
  Inactive = "Inactive",
  Banned = "Banned",
}

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
  
  // Check if it's a local file (starts with /uploads/)
  if (imageUrl.includes('/uploads/')) {
    try {
      // Extract filename from URL
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

      // Try to get from cache
      const cacheKey = CacheKeys.userProfile(currentUserId);
      let user = await RedisService.get(cacheKey);

      if (!user) {
        console.log("Current user profile not in cache, fetching from database...");

        const result = await query(
          `SELECT "UserID", "FullName", "Email", "Role", "Status", "Bio", 
                  "ProfileImageURL", "CreatedAt"
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
      
      // Get text fields from body
      const { fullName, bio } = req.body;
      
      // Handle file upload if present
      let profileImageURL = undefined;
      if (req.file) {
        const baseUrl = getBaseUrl(req);
        profileImageURL = `/uploads/profiles/${req.file.filename}`;
      }

      if (!currentUserId) {
        return res.status(401).json({
          success: false,
          errors: [formatError("auth", "User not authenticated")],
        });
      }

      // Check if user exists and get current profile image
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

      // Build update query dynamically based on provided fields
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

      if (profileImageURL !== undefined) {
        paramCount++;
        updates.push(`"ProfileImageURL" = $${paramCount}`);
        values.push(profileImageURL);
        
        // Delete old profile image
        await deleteOldProfileImage(existingUser.rows[0].ProfileImageURL);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          errors: [formatError("fields", "No fields to update")],
        });
      }

      // Add updated timestamp
      paramCount++;
      updates.push(`"UpdatedAt" = NOW()`);

      // Add user ID as last parameter
      values.push(currentUserId);

      const updateQuery = `
        UPDATE "User" 
        SET ${updates.join(', ')}
        WHERE "UserID" = $${paramCount}
        RETURNING "UserID", "FullName", "Email", "Role", "Status", "Bio", "ProfileImageURL", "CreatedAt"
      `;

      const updateResult = await query(updateQuery, values);
      const updatedUser = updateResult.rows[0];

      // Clear all related caches
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

// Update user password (with current password verification)
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

      // Validation
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

      // Get user with password hash
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

      // Verify current password
      const isValid = await comparePassword(currentPassword, userResult.rows[0].PasswordHash);
      if (!isValid) {
        return res.status(400).json({
          success: false,
          errors: [formatError("currentPassword", "Current password is incorrect")],
        });
      }

      // Hash new password
      const newPasswordHash = await hashPassword(newPassword);

      // Update password
      await query(
        `UPDATE "User" 
         SET "PasswordHash" = $1, "UpdatedAt" = NOW()
         WHERE "UserID" = $2`,
        [newPasswordHash, currentUserId],
      );

      // Clear all caches (force re-login)
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

// ==================== ADMIN ROUTES ====================

// Get all users (Admin only) with pagination and search
export const getAllUsers = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const currentUserRole = (req as any).user?.role;

      // Check if user is admin
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

      // Try to get from cache
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

      // Build query with filters
      let queryText = `
        SELECT "UserID", "FullName", "Email", "Role", "Status", "Bio", 
               "ProfileImageURL", "CreatedAt"
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

      // Get total count
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

      // Add pagination
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

      // Cache for 5 minutes (300 seconds)
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
      // Ensure id is treated as a string
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

      // Check if user is admin or accessing their own profile
      if (currentUserRole !== Role.Admin && currentUserId !== targetUserId) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "You can only view your own profile")],
        });
      }

      // Try to get from cache
      const cacheKey = CacheKeys.user(targetUserId);
      let user = await RedisService.get(cacheKey);

      if (!user) {
        console.log("User not in cache, fetching from database...");

        const result = await query(
          `SELECT "UserID", "FullName", "Email", "Role", "Status", "Bio", 
                  "ProfileImageURL", "CreatedAt"
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

        // Cache for 1 hour (3600 seconds)
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

// Update user profile by ID (Admin only) - with file upload support
export const updateUserProfileById = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      // Ensure id is treated as a string
      const idParam = req.params.id;
      const targetUserId = Array.isArray(idParam) ? idParam[0] : idParam;
      const currentUserRole = (req as any).user?.role;

      // Get text fields from body
      const { fullName, bio } = req.body;
      
      // Handle file upload if present
      let profileImageURL = undefined;
      if (req.file) {
        const baseUrl = getBaseUrl(req);
        profileImageURL = `/uploads/profiles/${req.file.filename}`;
      }

      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          errors: [formatError("id", "User ID is required")],
        });
      }

      // Check if user is admin
      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can update other users' profiles")],
        });
      }

      // Check if user exists and get current profile image
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

      // Build update query dynamically based on provided fields
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

      if (profileImageURL !== undefined) {
        paramCount++;
        updates.push(`"ProfileImageURL" = $${paramCount}`);
        values.push(profileImageURL);
        
        // Delete old profile image
        await deleteOldProfileImage(existingUser.rows[0].ProfileImageURL);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          errors: [formatError("fields", "No fields to update")],
        });
      }

      // Add updated timestamp
      paramCount++;
      updates.push(`"UpdatedAt" = NOW()`);

      // Add user ID as last parameter
      values.push(targetUserId);

      const updateQuery = `
        UPDATE "User" 
        SET ${updates.join(', ')}
        WHERE "UserID" = $${paramCount}
        RETURNING "UserID", "FullName", "Email", "Role", "Status", "Bio", "ProfileImageURL", "CreatedAt"
      `;

      const updateResult = await query(updateQuery, values);
      const updatedUser = updateResult.rows[0];

      // Clear all related caches
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
      // Ensure id is treated as a string
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

      // Check if user is admin
      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can update user roles")],
        });
      }

      // Validate role
      if (!role || !Object.values(Role).includes(role)) {
        return res.status(400).json({
          success: false,
          errors: [formatError("role", "Invalid role. Must be Admin, Mentor, or Learner")],
        });
      }

      // Check if user exists
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

      // Prevent admin from changing their own role
      if (targetUserId === (req as any).user?.UserID) {
        return res.status(400).json({
          success: false,
          errors: [formatError("role", "You cannot change your own role")],
        });
      }

      // Update role
      const updateResult = await query(
        `UPDATE "User" 
         SET "Role" = $1, "UpdatedAt" = NOW()
         WHERE "UserID" = $2
         RETURNING "UserID", "FullName", "Email", "Role", "Status"`,
        [role, targetUserId],
      );

      const updatedUser = updateResult.rows[0];

      // Clear all related caches
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
      // Ensure id is treated as a string
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

      // Check if user is admin
      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can update user status")],
        });
      }

      // Validate status
      if (!status || !Object.values(UserStatus).includes(status)) {
        return res.status(400).json({
          success: false,
          errors: [formatError("status", "Invalid status. Must be Active, Inactive, or Banned")],
        });
      }

      // Check if user exists
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

      // Prevent admin from changing their own status
      if (targetUserId === (req as any).user?.UserID) {
        return res.status(400).json({
          success: false,
          errors: [formatError("status", "You cannot change your own status")],
        });
      }

      // Update status
      const updateResult = await query(
        `UPDATE "User" 
         SET "Status" = $1, "UpdatedAt" = NOW()
         WHERE "UserID" = $2
         RETURNING "UserID", "FullName", "Email", "Role", "Status"`,
        [status, targetUserId],
      );

      const updatedUser = updateResult.rows[0];

      // Clear all related caches
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
      // Ensure id is treated as a string
      const idParam = req.params.id;
      const targetUserId = Array.isArray(idParam) ? idParam[0] : idParam;
      const currentUserRole = (req as any).user?.role;

      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          errors: [formatError("id", "User ID is required")],
        });
      }

      // Check if user is admin
      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can delete users")],
        });
      }

      // Check if user exists
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

      // Prevent admin from deleting themselves
      if (targetUserId === (req as any).user?.UserID) {
        return res.status(400).json({
          success: false,
          errors: [formatError("user", "You cannot delete your own account")],
        });
      }

      // Get user email and profile image for cache clearing and cleanup
      const userEmail = existingUser.rows[0].Email;
      const profileImageUrl = existingUser.rows[0].ProfileImageURL;

      // Delete profile image file if exists
      await deleteOldProfileImage(profileImageUrl);

      // Delete user (cascading delete should handle related records)
      await query(
        `DELETE FROM "User" WHERE "UserID" = $1`,
        [targetUserId],
      );

      // Clear all related caches
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

      // Check if user is admin
      if (currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("authorization", "Only admin can view user statistics")],
        });
      }

      // Try to get from cache
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

        // Cache for 1 hour
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