import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/env';
import { query } from '../db';
import { TokenBlacklist } from '../utils/tokenBlacklist.util';
import { RedisService } from '../utils/redis.util';

interface JwtPayload {
  id: string;
  role: string;
  iat?: number;
  exp?: number;
}

export const authenticateJWT = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized access' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Check if token is blacklisted
    const isBlacklisted = await TokenBlacklist.isTokenBlacklisted(token);
    if (isBlacklisted) {
      return res.status(401).json({ message: 'Token has been revoked' });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    // Check if user is blacklisted
    const isUserBlacklisted = await TokenBlacklist.isUserBlacklisted(decoded.id);
    if (isUserBlacklisted) {
      return res.status(401).json({ message: 'User session revoked' });
    }

    // Try to get user from Redis cache
    const cacheKey = `user:${decoded.id}`;
    let user = await RedisService.get(cacheKey);

    if (!user) {
      // If not in cache, fetch from database
      const userResult = await query(
        `SELECT "UserID", "Role", "Email" 
         FROM "User" 
         WHERE "UserID" = $1`,
        [decoded.id]
      );

      if (userResult.rowCount === 0) {
        return res.status(401).json({ message: 'Unauthorized access' });
      }

      user = userResult.rows[0];
      
      // Cache user for 1 hour
      await RedisService.setEx(cacheKey, 3600, user);
    }

    // Attach user payload to req
    (req as any).user = {
      UserID: user.UserID,
      role: user.Role,
      email: user.Email,
    };

    next();
  } catch (err) {
    console.log("JWT ERROR:", err);
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Role-based authorization
export const authorizeRoles = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ message: 'Forbidden access' });
    }

    next();
  };
};