import { Request, Response, NextFunction } from 'express';

interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  keyPrefix?: string;
}

// Simple in-memory rate limiter (no Redis)
const store = new Map<string, { count: number; resetAt: number }>();

export const rateLimiter = (options: RateLimitOptions = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = 'Too many requests, please try again later.',
    keyPrefix = 'rate_limit',
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const identifier = (req as any).user?.UserID || req.ip;
    const key = `${keyPrefix}:${identifier}`;
    const now = Date.now();

    const record = store.get(key);

    if (!record || now > record.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (record.count >= max) {
      return res.status(429).json({
        success: false,
        message,
      });
    }

    record.count++;
    const ttlMs = record.resetAt - now;

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', max - record.count);
    res.setHeader('X-RateLimit-Reset', record.resetAt);

    next();
  };
};