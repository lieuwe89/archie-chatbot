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
      const redisClient = createClient({ url: redisUrl, socket: { reconnectStrategy: (retries) => Math.min(retries * 50, 500) } });

      redisClient.on('error', (err) => {
        console.error('[Sessions] Redis error:', err.message);
      });

      await redisClient.connect();

      store = new RedisStore({ client: redisClient, prefix: 'archie:session:' });
      console.log('[Sessions] ✓ Connected to Redis');
      return store;
    } catch (err) {
      console.warn('[Sessions] ✗ Connection failed:', err.message, 'URL:', redisUrl.split(':')[1].substring(0, 20) + '...');
    }
  }

  console.log('[Sessions] Using SQLite session store');
  store = new SQLiteSessionStore();
  return store;
};

export { initSessionStore };
