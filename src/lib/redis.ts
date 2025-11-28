import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
  redisSub: Redis | undefined;
};

function createRedisClient(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL environment variable is not set');
  }
  
  const redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  redis.on('error', (err) => {
    console.error('Redis connection error:', err);
  });

  redis.on('connect', () => {
    console.log('Redis connected');
  });

  return redis;
}

// Main Redis client for commands
export const redis = globalForRedis.redis ?? createRedisClient();

// Separate client for pub/sub (required by ioredis)
export const redisSub = globalForRedis.redisSub ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
  globalForRedis.redisSub = redisSub;
}

// Key prefixes for organization
export const REDIS_KEYS = {
  // Active lobby state (in-memory for speed, backed up to DB)
  lobby: (code: string) => `lobby:${code}`,
  lobbyPlayers: (code: string) => `lobby:${code}:players`,
  
  // Socket session mapping
  socketToPlayer: (socketId: string) => `socket:${socketId}:player`,
  playerToSocket: (playerId: string) => `player:${playerId}:socket`,
  playerToLobby: (playerId: string) => `player:${playerId}:lobby`,
  
  // Active game state
  gameState: (gameId: string) => `game:${gameId}:state`,
  gameClues: (gameId: string) => `game:${gameId}:clues`,
  gameVotes: (gameId: string) => `game:${gameId}:votes`,
  
  // Session management
  session: (sessionId: string) => `session:${sessionId}`,
  
  // Reconnection queue
  reconnectQueue: (playerId: string) => `reconnect:${playerId}`,
} as const;

// TTL values in seconds
export const REDIS_TTL = {
  lobby: 60 * 60 * 4, // 4 hours
  session: 60 * 60 * 24, // 24 hours
  socket: 60 * 60, // 1 hour
  reconnect: 60 * 5, // 5 minutes grace period for reconnection
  gameState: 60 * 60 * 2, // 2 hours
} as const;

export default redis;
