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
  
  // ========== SKILL CATEGORY KEYS ==========
  skillCategory: (id: string) => `skill-category:${id}`,
  skillCategoryWithSkills: (id: string) => `skill-category:${id}:with-skills`,
  skillCategories: (page?: number, limit?: number, search?: string) => {
    const pageVal = page || 1;
    const limitVal = limit || 20;
    const searchVal = search || 'all';
    return `skill-categories:page:${pageVal}:limit:${limitVal}:search:${searchVal}`;
  },
  allSkillCategories: () => 'skill-categories:all',
  featuredSkillCategories: (limit?: number) => 
    `skill-categories:featured:limit:${limit || 10}`,
  skillCategoryStats: (id: string) => `skill-category:${id}:stats`,
  
  // ========== SKILL KEYS ==========
  skill: (skillId: string) => `skill:${skillId}`,
  skills: (page?: number, limit?: number, search?: string) => {
    const pageVal = page || 1;
    const limitVal = limit || 20;
    const searchVal = search || 'all';
    return `skills:page:${pageVal}:limit:${limitVal}:search:${searchVal}`;
  },
  skillsByCategory: (categoryId: string) => `skills:category:${categoryId}`,
  popularSkills: (limit?: number) => `skills:popular:limit:${limit || 10}`,
  
  // Helper method to delete patterns
  deletePattern: (pattern: string) => pattern,
};