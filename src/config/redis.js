const Redis = require('ioredis');

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

let isRedisAvailable = false;
let pubClient = null;
let subClient = null;
let redisPresence = null;

try {
  const options = {
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 3) return null; // Stop retrying quickly if no local Redis
      return 500;
    },
  };

  pubClient = new Redis(options);
  subClient = new Redis(options);
  redisPresence = new Redis(options);

  pubClient.connect().then(() => {
    isRedisAvailable = true;
    console.log('✅ Redis connected successfully.');
  }).catch(() => {
    console.log('ℹ️ Local Redis not active - running with in-memory store (standalone mode).');
  });

  pubClient.on('error', () => {});
  subClient.on('error', () => {});
  redisPresence.on('error', () => {});
} catch (e) {
  console.log('ℹ️ Running with in-memory presence store.');
}

module.exports = {
  get isRedisAvailable() { return isRedisAvailable; },
  pubClient,
  subClient,
  redisPresence,
};
