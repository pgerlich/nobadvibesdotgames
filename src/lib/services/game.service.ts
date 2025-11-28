import prisma from '../db';
import redis, { REDIS_KEYS, REDIS_TTL } from '../redis';
import lobbyService, { LobbyState, LobbyPlayer } from './lobby.service';

// Game categories and words
const CATEGORIES: Record<string, string[]> = {
  'Animals': ['Dog', 'Cat', 'Elephant', 'Giraffe', 'Lion', 'Tiger', 'Bear', 'Wolf', 'Fox', 'Rabbit', 'Deer', 'Horse'],
  'Food': ['Pizza', 'Burger', 'Sushi', 'Pasta', 'Taco', 'Salad', 'Steak', 'Sandwich', 'Soup', 'Curry', 'Ramen', 'Burrito'],
  'Movies': ['Titanic', 'Avatar', 'Inception', 'Jaws', 'Matrix', 'Frozen', 'Shrek', 'Gladiator', 'Psycho', 'Rocky', 'Alien', 'Joker'],
  'Sports': ['Soccer', 'Basketball', 'Tennis', 'Golf', 'Baseball', 'Hockey', 'Cricket', 'Rugby', 'Boxing', 'Swimming', 'Cycling', 'Skiing'],
  'Countries': ['France', 'Japan', 'Brazil', 'Egypt', 'Canada', 'Australia', 'Mexico', 'Italy', 'India', 'Germany', 'Spain', 'China'],
  'Professions': ['Doctor', 'Teacher', 'Chef', 'Pilot', 'Lawyer', 'Artist', 'Engineer', 'Nurse', 'Firefighter', 'Police', 'Astronaut', 'Scientist'],
};

export interface GameStartResult {
  category: string;
  allWords: string[];
  secretWord: string;
  chameleonId: string;
  playerOrder: LobbyPlayer[];
}

export interface VoteResult {
  mostVotedId: string;
  mostVotedName: string;
  voteCount: number;
  isChameleon: boolean;
  votes: Array<{ casterId: string; casterName: string; targetId: string; targetName: string }>;
}

export interface GameResult {
  chameleonId: string;
  chameleonName: string;
  secretWord: string;
  caughtChameleon: boolean;
  chameleonGuess: string | null;
  chameleonGuessedCorrectly: boolean;
  winningSide: 'chameleon' | 'players';
  votes: Array<{ name: string; votedFor: string }>;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

class GameService {
  /**
   * Start a new game round
   */
  async startGame(code: string): Promise<GameStartResult | null> {
    const lobby = await lobbyService.getLobbyState(code);
    if (!lobby || lobby.status !== 'waiting') return null;

    const players = await lobbyService.getLobbyPlayers(code);
    if (players.length < lobby.minPlayers) return null;

    // Select random category and word
    const categoryNames = Object.keys(CATEGORIES);
    const category = categoryNames[Math.floor(Math.random() * categoryNames.length)];
    const words = CATEGORIES[category];
    const secretWord = words[Math.floor(Math.random() * words.length)];

    // Select random chameleon
    const chameleonIndex = Math.floor(Math.random() * players.length);
    const chameleon = players[chameleonIndex];

    // Shuffle player order
    const playerOrder = shuffleArray(players);

    // Update lobby state
    lobby.status = 'playing';
    lobby.category = category;
    lobby.secretWord = secretWord;
    lobby.allWords = words;
    lobby.chameleonId = chameleon.id;
    lobby.playerOrder = playerOrder.map(p => p.id);
    lobby.currentPlayerIndex = 0;
    lobby.clues = {};
    lobby.votes = {};

    await lobbyService.saveLobbyState(code, lobby);

    // Update database
    await prisma.game.update({
      where: { id: lobby.gameId },
      data: {
        status: 'PLAYING',
        category,
        secretWord,
        chameleonId: chameleon.id,
        startedAt: new Date(),
      },
    });

    // Update player turn orders
    for (let i = 0; i < playerOrder.length; i++) {
      await prisma.gamePlayer.update({
        where: {
          gameId_playerId: { gameId: lobby.gameId, playerId: playerOrder[i].id },
        },
        data: {
          turnOrder: i,
          isChameleon: playerOrder[i].id === chameleon.id,
        },
      });
    }

    // Log event
    await prisma.gameEvent.create({
      data: {
        gameId: lobby.gameId,
        eventType: 'game_started',
        payload: { category, playerCount: players.length },
      },
    });

    return {
      category,
      allWords: words,
      secretWord,
      chameleonId: chameleon.id,
      playerOrder,
    };
  }

  /**
   * Submit a clue
   */
  async submitClue(code: string, playerId: string, clue: string): Promise<{
    success: boolean;
    nextPlayerId?: string;
    allCluesSubmitted?: boolean;
  }> {
    const lobby = await lobbyService.getLobbyState(code);
    if (!lobby || lobby.status !== 'playing') return { success: false };

    const players = await lobbyService.getLobbyPlayers(code);
    const currentPlayerId = lobby.playerOrder![lobby.currentPlayerIndex!];

    // Verify it's this player's turn
    if (currentPlayerId !== playerId) return { success: false };

    // Store clue
    if (!lobby.clues) lobby.clues = {};
    lobby.clues[playerId] = clue;

    // Save to database
    await prisma.gameClue.create({
      data: {
        gameId: lobby.gameId,
        playerId,
        clue,
        turnOrder: lobby.currentPlayerIndex!,
      },
    });

    await prisma.gameEvent.create({
      data: {
        gameId: lobby.gameId,
        eventType: 'clue_submitted',
        payload: { playerId, clue },
      },
    });

    // Move to next player
    lobby.currentPlayerIndex = (lobby.currentPlayerIndex || 0) + 1;

    const allCluesSubmitted = lobby.currentPlayerIndex >= players.length;

    if (allCluesSubmitted) {
      lobby.status = 'voting';
      await prisma.game.update({
        where: { id: lobby.gameId },
        data: { status: 'VOTING' },
      });
    }

    await lobbyService.saveLobbyState(code, lobby);

    return {
      success: true,
      nextPlayerId: allCluesSubmitted ? undefined : lobby.playerOrder![lobby.currentPlayerIndex],
      allCluesSubmitted,
    };
  }

  /**
   * Submit a vote
   */
  async submitVote(code: string, casterId: string, targetId: string): Promise<{
    success: boolean;
    votesCount: number;
    allVotesIn: boolean;
    voteResult?: VoteResult;
  }> {
    const lobby = await lobbyService.getLobbyState(code);
    if (!lobby || lobby.status !== 'voting') return { success: false, votesCount: 0, allVotesIn: false };

    const players = await lobbyService.getLobbyPlayers(code);

    // Store vote
    if (!lobby.votes) lobby.votes = {};
    if (lobby.votes[casterId]) {
      // Already voted
      return { success: false, votesCount: Object.keys(lobby.votes).length, allVotesIn: false };
    }

    lobby.votes[casterId] = targetId;

    // Save to database
    await prisma.gameVote.create({
      data: {
        gameId: lobby.gameId,
        casterId,
        targetId,
      },
    });

    await prisma.gameEvent.create({
      data: {
        gameId: lobby.gameId,
        eventType: 'vote_cast',
        payload: { casterId, targetId },
      },
    });

    await lobbyService.saveLobbyState(code, lobby);

    const votesCount = Object.keys(lobby.votes).length;
    const allVotesIn = votesCount >= players.length;

    if (!allVotesIn) {
      return { success: true, votesCount, allVotesIn };
    }

    // Tally votes
    const voteTally: Record<string, number> = {};
    for (const targetId of Object.values(lobby.votes)) {
      voteTally[targetId] = (voteTally[targetId] || 0) + 1;
    }

    let mostVotedId = '';
    let maxVotes = 0;
    for (const [id, count] of Object.entries(voteTally)) {
      if (count > maxVotes) {
        maxVotes = count;
        mostVotedId = id;
      }
    }

    const mostVotedPlayer = players.find(p => p.id === mostVotedId);
    const isChameleon = mostVotedId === lobby.chameleonId;

    const voteResult: VoteResult = {
      mostVotedId,
      mostVotedName: mostVotedPlayer?.name || 'Unknown',
      voteCount: maxVotes,
      isChameleon,
      votes: Object.entries(lobby.votes).map(([casterId, targetId]) => ({
        casterId,
        casterName: players.find(p => p.id === casterId)?.name || 'Unknown',
        targetId,
        targetName: players.find(p => p.id === targetId)?.name || 'Unknown',
      })),
    };

    // Update status based on whether chameleon was caught
    if (isChameleon) {
      lobby.status = 'guessing';
      await prisma.game.update({
        where: { id: lobby.gameId },
        data: { status: 'GUESSING' },
      });
    } else {
      lobby.status = 'finished';
    }

    await lobbyService.saveLobbyState(code, lobby);

    return { success: true, votesCount, allVotesIn: true, voteResult };
  }

  /**
   * Submit chameleon's guess
   */
  async submitGuess(code: string, guess: string): Promise<GameResult | null> {
    const lobby = await lobbyService.getLobbyState(code);
    if (!lobby || lobby.status !== 'guessing') return null;

    const players = await lobbyService.getLobbyPlayers(code);
    const chameleonPlayer = players.find(p => p.id === lobby.chameleonId);
    const guessCorrect = guess.toLowerCase().trim() === lobby.secretWord?.toLowerCase().trim();

    // Determine winner
    const winningSide = guessCorrect ? 'chameleon' : 'players';

    // Update database
    await prisma.game.update({
      where: { id: lobby.gameId },
      data: {
        status: 'FINISHED',
        chameleonCaught: true,
        chameleonGuess: guess,
        chameleonGuessCorrect: guessCorrect,
        winningSide,
        endedAt: new Date(),
      },
    });

    await prisma.gameEvent.create({
      data: {
        gameId: lobby.gameId,
        eventType: 'chameleon_guessed',
        payload: { guess, correct: guessCorrect },
      },
    });

    lobby.status = 'finished';
    await lobbyService.saveLobbyState(code, lobby);

    return {
      chameleonId: lobby.chameleonId!,
      chameleonName: chameleonPlayer?.name || 'Unknown',
      secretWord: lobby.secretWord!,
      caughtChameleon: true,
      chameleonGuess: guess,
      chameleonGuessedCorrectly: guessCorrect,
      winningSide,
      votes: Object.entries(lobby.votes || {}).map(([casterId, targetId]) => ({
        name: players.find(p => p.id === casterId)?.name || 'Unknown',
        votedFor: players.find(p => p.id === targetId)?.name || 'Unknown',
      })),
    };
  }

  /**
   * Get final results (when chameleon escaped)
   */
  async getResults(code: string): Promise<GameResult | null> {
    const lobby = await lobbyService.getLobbyState(code);
    if (!lobby) return null;

    const players = await lobbyService.getLobbyPlayers(code);
    const chameleonPlayer = players.find(p => p.id === lobby.chameleonId);

    // Determine if chameleon was caught based on votes
    const voteTally: Record<string, number> = {};
    for (const targetId of Object.values(lobby.votes || {})) {
      voteTally[targetId] = (voteTally[targetId] || 0) + 1;
    }

    let mostVotedId = '';
    let maxVotes = 0;
    for (const [id, count] of Object.entries(voteTally)) {
      if (count > maxVotes) {
        maxVotes = count;
        mostVotedId = id;
      }
    }

    const caughtChameleon = mostVotedId === lobby.chameleonId;
    const winningSide = caughtChameleon ? 'players' : 'chameleon';

    // Update database if not already finished
    if (lobby.status !== 'finished') {
      await prisma.game.update({
        where: { id: lobby.gameId },
        data: {
          status: 'FINISHED',
          chameleonCaught: caughtChameleon,
          winningSide,
          endedAt: new Date(),
        },
      });
    }

    return {
      chameleonId: lobby.chameleonId!,
      chameleonName: chameleonPlayer?.name || 'Unknown',
      secretWord: lobby.secretWord!,
      caughtChameleon,
      chameleonGuess: null,
      chameleonGuessedCorrectly: false,
      winningSide,
      votes: Object.entries(lobby.votes || {}).map(([casterId, targetId]) => ({
        name: players.find(p => p.id === casterId)?.name || 'Unknown',
        votedFor: players.find(p => p.id === targetId)?.name || 'Unknown',
      })),
    };
  }

  /**
   * Reset lobby for a new game
   */
  async resetLobby(code: string): Promise<{ players: LobbyPlayer[] } | null> {
    const lobby = await lobbyService.getLobbyState(code);
    if (!lobby) return null;

    const players = await lobbyService.getLobbyPlayers(code);

    // Create new game in database
    const newGame = await prisma.game.create({
      data: {
        code: lobby.code,
        gameType: lobby.gameType,
        status: 'WAITING',
        hostId: lobby.hostId,
      },
    });

    // Create player associations for new game
    for (const player of players) {
      await prisma.gamePlayer.create({
        data: {
          gameId: newGame.id,
          playerId: player.id,
          displayName: player.name,
          isHost: player.isHost,
        },
      });
    }

    // Reset lobby state
    lobby.gameId = newGame.id;
    lobby.status = 'waiting';
    lobby.category = undefined;
    lobby.secretWord = undefined;
    lobby.allWords = undefined;
    lobby.chameleonId = undefined;
    lobby.playerOrder = undefined;
    lobby.currentPlayerIndex = undefined;
    lobby.clues = undefined;
    lobby.votes = undefined;

    await lobbyService.saveLobbyState(code, lobby);

    return { players };
  }

  /**
   * Get player's game history
   */
  async getPlayerHistory(playerId: string, limit: number = 20): Promise<any[]> {
    const games = await prisma.gamePlayer.findMany({
      where: { playerId },
      include: {
        game: {
          include: {
            players: {
              select: {
                displayName: true,
                isChameleon: true,
              },
            },
          },
        },
      },
      orderBy: {
        game: { createdAt: 'desc' },
      },
      take: limit,
    });

    return games.map(gp => ({
      gameId: gp.game.id,
      code: gp.game.code,
      gameType: gp.game.gameType,
      status: gp.game.status,
      category: gp.game.category,
      secretWord: gp.game.secretWord,
      wasChameleon: gp.isChameleon,
      winningSide: gp.game.winningSide,
      playerCount: gp.game.players.length,
      playedAt: gp.game.createdAt,
      endedAt: gp.game.endedAt,
    }));
  }
}

export const gameService = new GameService();
export default gameService;
