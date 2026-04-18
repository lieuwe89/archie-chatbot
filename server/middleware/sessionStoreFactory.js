import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';
import { SQLiteSessionStore } from './sessionStore.js';

let store = null;

const initSessionStore = async () => {
  if (store) return store;

  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    try {
      console.log('[Sessions] Initializing Redis session store...');
      const redisClient = createClient({ url: redisUrl });

      redisClient.on('error', (err) => {
        console.error('[Sessions] Redis error:', err.message);
      });

      await redisClient.connect();

      store = new RedisStore({ client: redisClient, prefix: 'archie:session:' });
      console.log('[Sessions] Connected to Redis');
      return store;
    } catch (err) {
      console.warn('[Sessions] Redis connection failed, falling back to SQLite:', err.message);
    }
  }

  console.log('[Sessions] Using SQLite session store');
  store = new SQLiteSessionStore();
  return store;
};

export { initSessionStore };
