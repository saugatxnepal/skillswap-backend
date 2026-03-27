// src/controllers/auth.controller.ts
import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { formatError } from "../utils/formatError";
import { query } from "../db";
import { comparePassword, hashPassword } from "../utils/hash.util";
import { generateRefreshToken, generateToken } from "../utils/token.util";
import { Role, UserStatus } from "../constants/roles";
import { TokenBlacklist } from "../utils/tokenBlacklist.util";

// Register User
export const registerUser = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      let { fullName, email, password, role } = req.body;

      if (!fullName || !email || !password) {
        return res.status(400).json({
          success: false,
          errors: [formatError("fields", "All fields are required")],
        });
      }

      email = email.trim().toLowerCase();

      if (!role) {
        role = Role.Learner;
      }

      const currentUserRole = (req as any).user?.role;

      if (role === Role.Admin && currentUserRole !== Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("role", "Only admin can create admin users")],
        });
      }

      if (!currentUserRole && role === Role.Admin) {
        return res.status(403).json({
          success: false,
          errors: [formatError("role", "Admin registration not allowed")],
        });
      }

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
        ("UserID", "FullName", "Email", "PasswordHash", "Role", "Status", "CreatedAt", "UpdatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING "UserID", "FullName", "Email", "Role", "Status", "CreatedAt"`,
        [fullName, email, passwordHash, role, UserStatus.Active],
      );

      const newUser = insertUser.rows[0];

      return res.status(201).json({
        success: true,
        data: newUser,
      });
    } catch (error) {
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

    const token = generateToken(user);
    const refreshToken = generateRefreshToken(user);

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
    console.error("[Login] Error:", error);
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
});

// Logout User
export const logoutUser = asyncHandler(async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (token) {
      const decoded = JSON.parse(
        Buffer.from(token.split(".")[1], "base64").toString(),
      );
      const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

      if (expiresIn > 0) {
        await TokenBlacklist.blacklistToken(token, expiresIn);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("[Logout] Error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Logout failed")],
    });
  }
});

// Logout from all devices
export const logoutAllDevices = asyncHandler(async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const token = req.headers.authorization?.split(" ")[1];

    if (user?.UserID) {
      // Blacklist current token
      if (token) {
        const decoded = JSON.parse(
          Buffer.from(token.split(".")[1], "base64").toString(),
        );
        const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
        if (expiresIn > 0) {
          await TokenBlacklist.blacklistToken(token, expiresIn);
        }
      }

      // Blacklist the user globally
      await TokenBlacklist.blacklistUserTokens(user.UserID);
    }

    return res.status(200).json({
      success: true,
      message: "Logged out from all devices successfully",
    });
  } catch (error) {
    console.error("[LogoutAll] Error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Logout from all devices failed")],
    });
  }
});

// Get Profile
export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.UserID;

    const result = await query(
      `SELECT "UserID", "FullName", "Email", "Role", "Status", "CreatedAt", 
              "Bio", "ProfileImageURL", "Timezone", "NotificationPreferences"
       FROM "User" 
       WHERE "UserID" = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: [formatError("user", "User not found")],
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("[Profile] Error:", error);
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to fetch profile")],
    });
  }
});

// Get User Sessions (returns empty since sessions are no longer tracked in Redis)
export const getUserSessions = asyncHandler(
  async (req: Request, res: Response) => {
    return res.status(200).json({
      success: true,
      data: [],
    });
  },
);

// Verify Email
export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const result = await query(
      `SELECT "UserID", "Email" FROM "User" 
       WHERE "VerificationToken" = $1 AND "VerificationExpiry" > NOW()`,
      [token],
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        errors: [formatError("token", "Invalid or expired token")],
      });
    }

    await query(
      `UPDATE "User" SET "EmailVerified" = true, "Status" = $1 
       WHERE "UserID" = $2`,
      [UserStatus.Active, result.rows[0].UserID],
    );

    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      errors: [formatError("server", "Failed to verify email")],
    });
  }
});

// Check Email Availability
export const checkEmailAvailability = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const email = Array.isArray(req.params.email)
        ? req.params.email[0]
        : req.params.email;
      const normalizedEmail = email.trim().toLowerCase();

      const result = await query(
        'SELECT "UserID" FROM "User" WHERE "Email" = $1',
        [normalizedEmail],
      );

      const available = result.rows.length === 0;

      return res.status(200).json({
        success: true,
        data: {
          email: normalizedEmail,
          available,
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        errors: [formatError("server", "Failed to check email")],
      });
    }
  },
);

// Get User Activity
export const getUserActivity = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.UserID;

      const userResult = await query(
        `SELECT "CreatedAt" FROM "User" WHERE "UserID" = $1`,
        [userId],
      );

      const activity = {
        lastLogin: null,
        lastLoginIp: null,
        accountCreated: userResult.rows[0]?.CreatedAt || null,
        sessionCount: 0,
        recentActivity: [],
      };

      return res.status(200).json({
        success: true,
        data: activity,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        errors: [formatError("server", "Failed to fetch activity")],
      });
    }
  },
);