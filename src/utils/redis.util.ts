import redisClient from '../config/redis';

export class RedisService {
  // Set data with expiration
  static async set(key: string, value: any, ttlInSeconds?: number) {
    try {
      const serializedValue = JSON.stringify(value);
      if (ttlInSeconds) {
        await redisClient.setEx(key, ttlInSeconds, serializedValue);
      } else {
        await redisClient.set(key, serializedValue);
      }
      return true;
    } catch (error) {
      console.error('Redis set error:', error);
      return false;
    }
  }

  // Get data
  static async get(key: string) {
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Redis get error:', error);
      return null;
    }
  }

  // Delete data
  static async del(key: string) {
    try {
      await redisClient.del(key);
      return true;
    } catch (error) {
      console.error('Redis delete error:', error);
      return false;
    }
  }

  // Delete multiple keys by pattern
  static async delPattern(pattern: string) {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
      return true;
    } catch (error) {
      console.error('Redis delete pattern error:', error);
      return false;
    }
  }

  // Set with expiry in seconds
  static async setEx(key: string, ttlSeconds: number, value: any) {
    try {
      const serializedValue = JSON.stringify(value);
      await redisClient.setEx(key, ttlSeconds, serializedValue);
      return true;
    } catch (error) {
      console.error('Redis setEx error:', error);
      return false;
    }
  }

  // Get TTL of a key
  static async getTTL(key: string) {
    try {
      return await redisClient.ttl(key);
    } catch (error) {
      console.error('Redis TTL error:', error);
      return -2; // -2 means key doesn't exist
    }
  }

  // Check if key exists
  static async exists(key: string) {
    try {
      return await redisClient.exists(key);
    } catch (error) {
      console.error('Redis exists error:', error);
      return false;
    }
  }

  // Increment counter
  static async incr(key: string) {
    try {
      return await redisClient.incr(key);
    } catch (error) {
      console.error('Redis incr error:', error);
      return null;
    }
  }

  // Set with expiration and return old value
  static async getSet(key: string, value: any) {
    try {
      const oldValue = await redisClient.getSet(key, JSON.stringify(value));
      return oldValue ? JSON.parse(oldValue) : null;
    } catch (error) {
      console.error('Redis getSet error:', error);
      return null;
    }
  }
}