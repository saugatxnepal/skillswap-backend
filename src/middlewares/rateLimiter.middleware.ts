import { Request, Response, NextFunction } from 'express';
import { RedisService } from '../utils/redis.util';

interface RateLimitOptions {
  windowMs?: number; // Time window in milliseconds
  max?: number; // Max requests per window
  message?: string;
  keyPrefix?: string;
}

export const rateLimiter = (options: RateLimitOptions = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes default
    max = 100, // 100 requests per windowMs default
    message = 'Too many requests, please try again later.',
    keyPrefix = 'rate_limit',
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Use IP or user ID as identifier
      const identifier = (req as any).user?.UserID || req.ip;
      const key = `${keyPrefix}:${identifier}`;

      // Get current count
      const current = await RedisService.get(key) as number | null;
      
      if (current === null) {
        // First request in window
        await RedisService.setEx(key, windowMs / 1000, 1);
        return next();
      }

      if (current >= max) {
        return res.status(429).json({
          success: false,
          message: message,
        });
      }

      // Increment counter
      await RedisService.incr(key);
      
      // Get remaining TTL
      const ttl = await RedisService.getTTL(key);
      
      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', max - (current + 1));
      res.setHeader('X-RateLimit-Reset', Date.now() + (ttl * 1000));

      next();
    } catch (error) {
      console.error('Rate limiter error:', error);
      next(); // Proceed if rate limiter fails
    }
  };
};