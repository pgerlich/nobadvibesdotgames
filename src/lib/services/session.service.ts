import { v4 as uuidv4 } from "uuid";
import prisma from "../db";
import redis, { REDIS_KEYS, REDIS_TTL } from "../redis";

export interface SessionData {
  id: string;
  playerId: string;
  playerName: string;
  visitorId?: string;
  currentLobbyCode?: string;
  currentGameId?: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface SocketSession {
  socketId: string;
  playerId: string;
  playerName: string;
  lobbyCode?: string;
  gameId?: string;
}

class SessionService {
  /**
   * Create or get a player based on visitor ID (browser fingerprint)
   */
  async getOrCreatePlayer(
    visitorId: string | undefined,
    displayName: string
  ): Promise<{ id: string; name: string; isNew: boolean }> {
    // If we have a visitor ID, try to find existing player
    if (visitorId) {
      const existing = await prisma.player.findUnique({
        where: { visitorId },
      });

      if (existing) {
        // Update name if changed
        if (existing.name !== displayName) {
          await prisma.player.update({
            where: { id: existing.id },
            data: { name: displayName },
          });
        }
        return { id: existing.id, name: displayName, isNew: false };
      }
    }

    // Create new player
    const player = await prisma.player.create({
      data: {
        visitorId: visitorId || null,
        name: displayName,
      },
    });

    return { id: player.id, name: player.name, isNew: true };
  }

  /**
   * Create a new session
   */
  async createSession(
    playerId: string,
    playerName: string,
    visitorId?: string
  ): Promise<SessionData> {
    const sessionId = uuidv4();
    const now = Date.now();

    const session: SessionData = {
      id: sessionId,
      playerId,
      playerName,
      visitorId,
      createdAt: now,
      lastSeenAt: now,
    };

    await redis.setex(
      REDIS_KEYS.session(sessionId),
      REDIS_TTL.session,
      JSON.stringify(session)
    );

    return session;
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    const data = await redis.get(REDIS_KEYS.session(sessionId));
    if (!data) return null;
    return JSON.parse(data) as SessionData;
  }

  /**
   * Update session
   */
  async updateSession(
    sessionId: string,
    updates: Partial<SessionData>
  ): Promise<SessionData | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const updated: SessionData = {
      ...session,
      ...updates,
      lastSeenAt: Date.now(),
    };

    await redis.setex(
      REDIS_KEYS.session(sessionId),
      REDIS_TTL.session,
      JSON.stringify(updated)
    );

    return updated;
  }

  /**
   * Register a socket connection for a player
   */
  async registerSocket(
    socketId: string,
    playerId: string,
    playerName: string,
    lobbyCode?: string
  ): Promise<void> {
    const socketSession: SocketSession = {
      socketId,
      playerId,
      playerName,
      lobbyCode,
    };

    // Map socket -> player
    await redis.setex(
      REDIS_KEYS.socketToPlayer(socketId),
      REDIS_TTL.socket,
      JSON.stringify(socketSession)
    );

    // Map player -> socket (for finding player's connection)
    await redis.setex(
      REDIS_KEYS.playerToSocket(playerId),
      REDIS_TTL.socket,
      socketId
    );

    // Map player -> lobby
    if (lobbyCode) {
      await redis.setex(
        REDIS_KEYS.playerToLobby(playerId),
        REDIS_TTL.lobby,
        lobbyCode
      );
    }
  }

  /**
   * Get socket session by socket ID
   */
  async getSocketSession(socketId: string): Promise<SocketSession | null> {
    const data = await redis.get(REDIS_KEYS.socketToPlayer(socketId));
    if (!data) return null;
    return JSON.parse(data) as SocketSession;
  }

  /**
   * Get player's current socket ID
   */
  async getPlayerSocketId(playerId: string): Promise<string | null> {
    return redis.get(REDIS_KEYS.playerToSocket(playerId));
  }

  /**
   * Get player's current lobby code
   */
  async getPlayerLobbyCode(playerId: string): Promise<string | null> {
    return redis.get(REDIS_KEYS.playerToLobby(playerId));
  }

  /**
   * Handle socket disconnection - queue for potential reconnection
   */
  async handleDisconnect(socketId: string): Promise<SocketSession | null> {
    const session = await this.getSocketSession(socketId);
    if (!session) return null;

    // Store reconnection data with TTL
    await redis.setex(
      REDIS_KEYS.reconnectQueue(session.playerId),
      REDIS_TTL.reconnect,
      JSON.stringify({
        ...session,
        disconnectedAt: Date.now(),
      })
    );

    // Clean up socket mappings
    await redis.del(REDIS_KEYS.socketToPlayer(socketId));
    await redis.del(REDIS_KEYS.playerToSocket(session.playerId));

    return session;
  }

  /**
   * Check if player can reconnect (within grace period)
   */
  async getReconnectionData(
    playerId: string
  ): Promise<(SocketSession & { disconnectedAt: number }) | null> {
    const data = await redis.get(REDIS_KEYS.reconnectQueue(playerId));
    if (!data) return null;
    return JSON.parse(data);
  }

  /**
   * Clear reconnection queue after successful reconnection
   */
  async clearReconnection(playerId: string): Promise<void> {
    await redis.del(REDIS_KEYS.reconnectQueue(playerId));
  }

  /**
   * Update player's lobby association
   */
  async setPlayerLobby(
    playerId: string,
    lobbyCode: string | null
  ): Promise<void> {
    if (lobbyCode) {
      await redis.setex(
        REDIS_KEYS.playerToLobby(playerId),
        REDIS_TTL.lobby,
        lobbyCode
      );
    } else {
      await redis.del(REDIS_KEYS.playerToLobby(playerId));
    }
  }
}

export const sessionService = new SessionService();
export default sessionService;
