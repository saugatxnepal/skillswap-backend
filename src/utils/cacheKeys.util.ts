// src/utils/cacheKeys.util.ts
export const CacheKeys = {
  // User related keys
  user: (userId: string) => `user:${userId}`,
  userByEmail: (email: string) => `user:email:${email}`,
  users: (page?: number, limit?: number) => `users:page:${page || 1}:limit:${limit || 10}`,
  userProfile: (userId: string) => `user:profile:${userId}`,
  userSessions: (userId: string) => `user:${userId}:sessions`,
  userActivity: (userId: string) => `user:${userId}:activity`,
  
  // Auth related
  verificationToken: (token: string) => `verify:${token}`,
  resetToken: (token: string) => `reset:${token}`,
  blacklistedToken: (token: string) => `blacklist:${token}`,
};