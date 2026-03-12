// src/config/redis.ts
import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisPassword = process.env.REDIS_PASSWORD; // Get password from env

const isSecure = redisUrl.startsWith('rediss://');

const redisClient = createClient({
  url: redisUrl,
  password: redisPassword, // ADD THIS - send password for authentication
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.log('Too many retries on Redis. Connection Terminated');
        return new Error('Too many retries');
      }
      return Math.min(retries * 100, 3000);
    },
    connectTimeout: 10000,
    // Let the URL protocol (redis:// vs rediss://) determine SSL
  },
});

redisClient.on('error', (err) => console.error('Redis Client Error:', err));
redisClient.on('connect', () => console.log(`Redis Client Connected (${isSecure ? 'SSL' : 'Non-SSL'})`));

export const connectRedis = async () => {
  try {
    await redisClient.connect();
    console.log('✅ Redis authenticated successfully');
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
  }
};

export default redisClient;