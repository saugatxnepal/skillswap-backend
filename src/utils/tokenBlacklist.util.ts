import { RedisService } from './redis.util';

export class TokenBlacklist {
  // Add token to blacklist
  static async blacklistToken(token: string, expiresIn: number) {
    const key = `blacklist:token:${token}`;
    await RedisService.setEx(key, expiresIn, 'blacklisted');
  }

  // Check if token is blacklisted
  static async isTokenBlacklisted(token: string) {
    const key = `blacklist:token:${token}`;
    return await RedisService.exists(key);
  }

  // Blacklist all user tokens (logout from all devices)
  static async blacklistUserTokens(userId: string) {
    const key = `blacklist:user:${userId}`;
    await RedisService.setEx(key, 7 * 24 * 60 * 60, Date.now().toString()); // 7 days
  }

  // Check if user tokens are blacklisted
  static async isUserBlacklisted(userId: string) {
    const key = `blacklist:user:${userId}`;
    return await RedisService.exists(key);
  }
}