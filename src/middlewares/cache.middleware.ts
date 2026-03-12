import { Request, Response, NextFunction } from 'express';
import { RedisService } from '../utils/redis.util';

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  keyPrefix?: string;
}

export const cacheMiddleware = (options: CacheOptions = {}) => {
  const { ttl = 3600, keyPrefix = 'cache' } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Generate cache key based on URL and query parameters
      const cacheKey = `${keyPrefix}:${req.originalUrl}`;

      // Check if data exists in cache
      const cachedData = await RedisService.get(cacheKey);

      if (cachedData) {
        return res.status(200).json({
          success: true,
          data: cachedData,
          fromCache: true,
        });
      }

      // Store original send function
      const originalSend = res.json;

      // Override res.json to cache the response
      res.json = function (body) {
        if (body.success) {
          // Cache only successful responses
          RedisService.setEx(cacheKey, ttl, body.data);
        }
        return originalSend.call(this, body);
      };

      next();
    } catch (error) {
      console.error('Cache middleware error:', error);
      next(); // Proceed even if cache fails
    }
  };
};