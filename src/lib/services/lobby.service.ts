import prisma from "../db";
import redis, { REDIS_KEYS, REDIS_TTL } from "../redis";

export interface LobbyPlayer {
  id: string; // Player ID from database
  socketId: string;
  name: string;
  isHost: boolean;
  isConnected: boolean;
  disconnectedAt?: number;
}

export interface LobbyState {
  code: string;
  gameId: string; // Database game ID
  hostId: string;
  hostSocketId: string;
  status: "waiting" | "playing" | "voting" | "guessing" | "finished";
  gameType: string;
  maxPlayers: number;
  minPlayers: number;
  createdAt: number;

  // Game-specific state (for active games)
  category?: string;
  secretWord?: string;
  allWords?: string[];
  chameleonId?: string;
  playerOrder?: string[]; // Array of player IDs
  currentPlayerIndex?: number;
  clues?: Record<string, string>; // playerId -> clue
  votes?: Record<string, string>; // voterId -> targetId
}

class LobbyService {
  private readonly CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

  /**
   * Generate a unique 4-letter lobby code
   */
  private async generateCode(): Promise<string> {
    let code: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      code = "";
      for (let i = 0; i < 4; i++) {
        code += this.CODE_CHARS.charAt(
          Math.floor(Math.random() * this.CODE_CHARS.length)
        );
      }
      attempts++;

      // Check if code exists in Redis or database
      const existsInRedis = await redis.exists(REDIS_KEYS.lobby(code));
      if (!existsInRedis) {
        const existsInDb = await prisma.game.findFirst({
          where: {
            code,
            status: { in: ["WAITING", "PLAYING", "VOTING", "GUESSING"] },
          },
        });
        if (!existsInDb) break;
      }
    } while (attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      throw new Error("Failed to generate unique lobby code");
    }

    return code;
  }

  /**
   * Create a new lobby
   */
  async createLobby(
    hostPlayerId: string,
    hostSocketId: string,
    hostName: string,
    gameType: string = "undercover"
  ): Promise<{ lobby: LobbyState; player: LobbyPlayer }> {
    const code = await this.generateCode();

    // Create game record in database
    const game = await prisma.game.create({
      data: {
        code,
        gameType,
        status: "WAITING",
        hostId: hostPlayerId,
      },
    });

    // Create player-game association
    await prisma.gamePlayer.create({
      data: {
        gameId: game.id,
        playerId: hostPlayerId,
        displayName: hostName,
        isHost: true,
        turnOrder: 0,
      },
    });

    // Log event
    await prisma.gameEvent.create({
      data: {
        gameId: game.id,
        eventType: "lobby_created",
        payload: { hostName, code },
      },
    });

    const lobby: LobbyState = {
      code,
      gameId: game.id,
      hostId: hostPlayerId,
      hostSocketId,
      status: "waiting",
      gameType,
      maxPlayers: 10,
      minPlayers: 3,
      createdAt: Date.now(),
    };

    const hostPlayer: LobbyPlayer = {
      id: hostPlayerId,
      socketId: hostSocketId,
      name: hostName,
      isHost: true,
      isConnected: true,
    };

    // Store in Redis
    await this.saveLobbyState(code, lobby);
    await this.addPlayerToLobby(code, hostPlayer);

    return { lobby, player: hostPlayer };
  }

  /**
   * Join an existing lobby
   */
  async joinLobby(
    code: string,
    playerId: string,
    socketId: string,
    playerName: string
  ): Promise<{
    lobby: LobbyState;
    player: LobbyPlayer;
    players: LobbyPlayer[];
  } | null> {
    const upperCode = code.toUpperCase();
    const lobby = await this.getLobbyState(upperCode);

    if (!lobby) return null;
    if (lobby.status !== "waiting") return null;

    const players = await this.getLobbyPlayers(upperCode);
    if (players.length >= lobby.maxPlayers) return null;

    // Check if name is already taken
    if (players.some((p) => p.name === playerName && p.id !== playerId)) {
      return null;
    }

    // Check if player is already in lobby (reconnecting)
    const existingPlayer = players.find((p) => p.id === playerId);
    if (existingPlayer) {
      // Update socket ID and connection status
      existingPlayer.socketId = socketId;
      existingPlayer.isConnected = true;
      delete existingPlayer.disconnectedAt;
      await this.updatePlayerInLobby(upperCode, existingPlayer);
      return { lobby, player: existingPlayer, players };
    }

    // Add new player to database
    await prisma.gamePlayer.create({
      data: {
        gameId: lobby.gameId,
        playerId,
        displayName: playerName,
        isHost: false,
        turnOrder: players.length,
      },
    });

    // Log event
    await prisma.gameEvent.create({
      data: {
        gameId: lobby.gameId,
        eventType: "player_joined",
        payload: { playerName },
      },
    });

    const newPlayer: LobbyPlayer = {
      id: playerId,
      socketId,
      name: playerName,
      isHost: false,
      isConnected: true,
    };

    await this.addPlayerToLobby(upperCode, newPlayer);
    const updatedPlayers = await this.getLobbyPlayers(upperCode);

    return { lobby, player: newPlayer, players: updatedPlayers };
  }

  /**
   * Remove player from lobby
   */
  async leaveLobby(
    code: string,
    playerId: string
  ): Promise<{
    removed: boolean;
    newHost?: LobbyPlayer;
    remainingPlayers: LobbyPlayer[];
    lobbyDeleted: boolean;
  }> {
    const lobby = await this.getLobbyState(code);
    if (!lobby)
      return { removed: false, remainingPlayers: [], lobbyDeleted: false };

    let players = await this.getLobbyPlayers(code);
    const playerIndex = players.findIndex((p) => p.id === playerId);

    if (playerIndex === -1)
      return { removed: false, remainingPlayers: players, lobbyDeleted: false };

    const leavingPlayer = players[playerIndex];
    players.splice(playerIndex, 1);

    // Update database
    await prisma.gamePlayer.deleteMany({
      where: { gameId: lobby.gameId, playerId },
    });

    await prisma.gameEvent.create({
      data: {
        gameId: lobby.gameId,
        eventType: "player_left",
        payload: { playerName: leavingPlayer.name },
      },
    });

    // If no players left, delete lobby
    if (players.length === 0) {
      await this.deleteLobby(code);
      await prisma.game.update({
        where: { id: lobby.gameId },
        data: { status: "CANCELLED" },
      });
      return { removed: true, remainingPlayers: [], lobbyDeleted: true };
    }

    // Transfer host if needed
    let newHost: LobbyPlayer | undefined;
    if (leavingPlayer.isHost) {
      newHost = players[0];
      newHost.isHost = true;
      lobby.hostId = newHost.id;
      lobby.hostSocketId = newHost.socketId;

      await this.updatePlayerInLobby(code, newHost);
      await this.saveLobbyState(code, lobby);

      await prisma.gamePlayer.update({
        where: {
          gameId_playerId: { gameId: lobby.gameId, playerId: newHost.id },
        },
        data: { isHost: true },
      });

      await prisma.game.update({
        where: { id: lobby.gameId },
        data: { hostId: newHost.id },
      });
    }

    // Update Redis players list
    await this.saveLobbyPlayers(code, players);

    return {
      removed: true,
      newHost,
      remainingPlayers: players,
      lobbyDeleted: false,
    };
  }

  /**
   * Handle player disconnect (with reconnection grace period)
   */
  async handlePlayerDisconnect(code: string, playerId: string): Promise<void> {
    const players = await this.getLobbyPlayers(code);
    const player = players.find((p) => p.id === playerId);

    if (player) {
      player.isConnected = false;
      player.disconnectedAt = Date.now();
      await this.updatePlayerInLobby(code, player);
    }
  }

  /**
   * Handle player reconnection
   */
  async handlePlayerReconnect(
    code: string,
    playerId: string,
    newSocketId: string
  ): Promise<{
    lobby: LobbyState;
    player: LobbyPlayer;
    players: LobbyPlayer[];
  } | null> {
    const lobby = await this.getLobbyState(code);
    if (!lobby) return null;

    const players = await this.getLobbyPlayers(code);
    const player = players.find((p) => p.id === playerId);

    if (!player) return null;

    // Update socket ID and connection status
    player.socketId = newSocketId;
    player.isConnected = true;
    delete player.disconnectedAt;

    // Update host socket if this is the host
    if (player.isHost) {
      lobby.hostSocketId = newSocketId;
      await this.saveLobbyState(code, lobby);
    }

    await this.updatePlayerInLobby(code, player);

    return { lobby, player, players };
  }

  // Redis helper methods

  async getLobbyState(code: string): Promise<LobbyState | null> {
    const data = await redis.get(REDIS_KEYS.lobby(code));
    if (!data) return null;
    return JSON.parse(data) as LobbyState;
  }

  async saveLobbyState(code: string, lobby: LobbyState): Promise<void> {
    await redis.setex(
      REDIS_KEYS.lobby(code),
      REDIS_TTL.lobby,
      JSON.stringify(lobby)
    );
  }

  async getLobbyPlayers(code: string): Promise<LobbyPlayer[]> {
    const data = await redis.get(REDIS_KEYS.lobbyPlayers(code));
    if (!data) return [];
    return JSON.parse(data) as LobbyPlayer[];
  }

  async saveLobbyPlayers(code: string, players: LobbyPlayer[]): Promise<void> {
    await redis.setex(
      REDIS_KEYS.lobbyPlayers(code),
      REDIS_TTL.lobby,
      JSON.stringify(players)
    );
  }

  async addPlayerToLobby(code: string, player: LobbyPlayer): Promise<void> {
    const players = await this.getLobbyPlayers(code);
    const existingIndex = players.findIndex((p) => p.id === player.id);

    if (existingIndex >= 0) {
      players[existingIndex] = player;
    } else {
      players.push(player);
    }

    await this.saveLobbyPlayers(code, players);
  }

  async updatePlayerInLobby(code: string, player: LobbyPlayer): Promise<void> {
    await this.addPlayerToLobby(code, player);
  }

  async deleteLobby(code: string): Promise<void> {
    await redis.del(REDIS_KEYS.lobby(code));
    await redis.del(REDIS_KEYS.lobbyPlayers(code));
  }

  /**
   * Get lobby by code, checking Redis first then database
   */
  async findLobby(code: string): Promise<LobbyState | null> {
    const upperCode = code.toUpperCase();

    // Check Redis first
    let lobby = await this.getLobbyState(upperCode);
    if (lobby) return lobby;

    // Check database for active game
    const game = await prisma.game.findFirst({
      where: {
        code: upperCode,
        status: { in: ["WAITING", "PLAYING", "VOTING", "GUESSING"] },
      },
      include: {
        players: true,
      },
    });

    if (!game) return null;

    // Reconstruct lobby state from database
    const host = game.players.find((p) => p.isHost);
    if (!host) return null;

    lobby = {
      code: game.code,
      gameId: game.id,
      hostId: host.playerId,
      hostSocketId: "", // Will be updated on reconnection
      status: game.status.toLowerCase() as LobbyState["status"],
      gameType: game.gameType,
      maxPlayers: 10,
      minPlayers: 3,
      createdAt: game.createdAt.getTime(),
      category: game.category || undefined,
      secretWord: game.secretWord || undefined,
    };

    return lobby;
  }
}

export const lobbyService = new LobbyService();
export default lobbyService;
