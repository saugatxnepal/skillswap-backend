// src/utils/tokenBlacklist.util.ts
// In-memory token blacklist (no Redis)

const blacklistedTokens = new Set<string>();
const blacklistedUsers = new Map<string, number>(); // userId -> blacklist timestamp

export class TokenBlacklist {
  // Add token to blacklist
  static async blacklistToken(token: string, _expiresIn: number) {
    blacklistedTokens.add(token);
  }

  // Check if token is blacklisted
  static async isTokenBlacklisted(token: string) {
    return blacklistedTokens.has(token) ? 1 : 0;
  }

  // Blacklist all user tokens (logout from all devices)
  static async blacklistUserTokens(userId: string) {
    blacklistedUsers.set(userId, Date.now());
  }

  // Check if user tokens are blacklisted
  static async isUserBlacklisted(userId: string) {
    return blacklistedUsers.has(userId) ? 1 : 0;
  }

  // Remove user blacklist (for admin to restore)
  static async removeUserBlacklist(userId: string) {
    blacklistedUsers.delete(userId);
  }
}
