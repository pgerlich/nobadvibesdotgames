import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server } from 'socket.io';
import type { Player, Lobby, GameState } from './src/types/game';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Game categories and words
const categories: Record<string, string[]> = {
  'Animals': ['Dog', 'Cat', 'Elephant', 'Giraffe', 'Lion', 'Tiger', 'Bear', 'Wolf', 'Fox', 'Rabbit', 'Deer', 'Horse'],
  'Food': ['Pizza', 'Burger', 'Sushi', 'Pasta', 'Taco', 'Salad', 'Steak', 'Sandwich', 'Soup', 'Curry', 'Ramen', 'Burrito'],
  'Movies': ['Titanic', 'Avatar', 'Inception', 'Jaws', 'Matrix', 'Frozen', 'Shrek', 'Gladiator', 'Psycho', 'Rocky', 'Alien', 'Joker'],
  'Sports': ['Soccer', 'Basketball', 'Tennis', 'Golf', 'Baseball', 'Hockey', 'Cricket', 'Rugby', 'Boxing', 'Swimming', 'Cycling', 'Skiing'],
  'Countries': ['France', 'Japan', 'Brazil', 'Egypt', 'Canada', 'Australia', 'Mexico', 'Italy', 'India', 'Germany', 'Spain', 'China'],
  'Professions': ['Doctor', 'Teacher', 'Chef', 'Pilot', 'Lawyer', 'Artist', 'Engineer', 'Nurse', 'Firefighter', 'Police', 'Astronaut', 'Scientist'],
};

// Store active lobbies
const lobbies = new Map<string, Lobby>();

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return lobbies.has(code) ? generateCode() : code;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
  });

  io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('create-lobby', (playerName: string) => {
      const code = generateCode();
      const player: Player = {
        id: socket.id,
        name: playerName,
        isHost: true,
        clue: null,
        vote: null,
        hasVoted: false,
      };

      const lobby: Lobby = {
        code,
        host: socket.id,
        players: [player],
        state: 'waiting',
        category: null,
        secretWord: null,
        allWords: [],
        chameleonId: null,
        playerOrder: [],
        currentPlayerIndex: 0,
        roundEndTime: null,
        mostVoted: null,
        voteCount: 0,
        caughtChameleon: false,
        chameleonGuess: null,
        chameleonGuessedCorrectly: false,
      };

      lobbies.set(code, lobby);
      socket.join(code);
      socket.emit('lobby-created', { code, players: lobby.players });
      console.log(`Lobby ${code} created by ${playerName}`);
    });

    socket.on('join-lobby', ({ code, playerName }: { code: string; playerName: string }) => {
      const lobby = lobbies.get(code.toUpperCase());
      if (!lobby) {
        socket.emit('error', 'Lobby not found');
        return;
      }
      if (lobby.state !== 'waiting') {
        socket.emit('error', 'Game already in progress');
        return;
      }
      if (lobby.players.length >= 10) {
        socket.emit('error', 'Lobby is full');
        return;
      }
      if (lobby.players.some((p) => p.name === playerName)) {
        socket.emit('error', 'Name already taken');
        return;
      }

      const player: Player = {
        id: socket.id,
        name: playerName,
        isHost: false,
        clue: null,
        vote: null,
        hasVoted: false,
      };

      lobby.players.push(player);
      socket.join(lobby.code);
      socket.emit('lobby-joined', { code: lobby.code, players: lobby.players });
      io.to(lobby.code).emit('player-joined', { players: lobby.players });
      console.log(`${playerName} joined lobby ${code}`);
    });

    socket.on('rejoin-lobby', ({ code, playerName }: { code: string; playerName: string }) => {
      const lobby = lobbies.get(code?.toUpperCase());
      if (!lobby) {
        socket.emit('rejoin-failed');
        return;
      }

      const existingPlayer = lobby.players.find((p) => p.name === playerName);
      if (!existingPlayer) {
        if (lobby.state === 'waiting' && lobby.players.length < 10) {
          const player: Player = {
            id: socket.id,
            name: playerName,
            isHost: false,
            clue: null,
            vote: null,
            hasVoted: false,
          };
          lobby.players.push(player);
          socket.join(lobby.code);
          socket.emit('rejoin-success', {
            code: lobby.code,
            players: lobby.players,
            state: lobby.state,
            isHost: false,
          });
          io.to(lobby.code).emit('player-joined', { players: lobby.players });
          console.log(`${playerName} joined lobby ${code} via rejoin`);
        } else {
          socket.emit('rejoin-failed');
        }
        return;
      }

      const oldId = existingPlayer.id;
      existingPlayer.id = socket.id;
      delete existingPlayer.disconnectedAt;
      delete existingPlayer.disconnectedSocketId;

      if (lobby.host === oldId) {
        lobby.host = socket.id;
      }
      if (lobby.chameleonId === oldId) {
        lobby.chameleonId = socket.id;
      }
      if (lobby.playerOrder) {
        const orderPlayer = lobby.playerOrder.find((p) => p.id === oldId);
        if (orderPlayer) orderPlayer.id = socket.id;
      }

      socket.join(lobby.code);
      socket.emit('rejoin-success', {
        code: lobby.code,
        players: lobby.players,
        state: lobby.state,
        isHost: lobby.host === socket.id,
      });
      console.log(`${playerName} rejoined lobby ${code}`);
    });

    socket.on('leave-lobby', (code: string) => {
      const lobby = lobbies.get(code);
      if (!lobby) return;

      const playerIndex = lobby.players.findIndex((p) => p.id === socket.id);
      if (playerIndex === -1) return;

      const player = lobby.players[playerIndex];
      lobby.players.splice(playerIndex, 1);
      socket.leave(code);

      if (lobby.players.length === 0) {
        lobbies.delete(code);
        console.log(`Lobby ${code} deleted (empty)`);
        return;
      }

      if (player.isHost && lobby.players.length > 0) {
        lobby.players[0].isHost = true;
        lobby.host = lobby.players[0].id;
      }

      io.to(code).emit('player-left', { players: lobby.players, leftPlayer: player.name });
    });

    socket.on('start-game', (code: string) => {
      const lobby = lobbies.get(code);
      if (!lobby) return;
      if (lobby.host !== socket.id) return;
      if (lobby.players.length < 3) return;

      const categoryNames = Object.keys(categories);
      const category = categoryNames[Math.floor(Math.random() * categoryNames.length)];
      const words = categories[category];
      const secretWord = words[Math.floor(Math.random() * words.length)];

      const chameleonIndex = Math.floor(Math.random() * lobby.players.length);
      const chameleon = lobby.players[chameleonIndex];

      lobby.state = 'playing';
      lobby.category = category;
      lobby.secretWord = secretWord;
      lobby.allWords = words;
      lobby.chameleonId = chameleon.id;
      lobby.playerOrder = shuffleArray([...lobby.players]);
      lobby.currentPlayerIndex = 0;

      lobby.players.forEach((p) => {
        p.clue = null;
        p.vote = null;
        p.hasVoted = false;
      });

      lobby.players.forEach((p) => {
        const isChameleon = p.id === chameleon.id;
        io.to(p.id).emit('game-started', {
          category,
          allWords: words,
          secretWord: isChameleon ? null : secretWord,
          isChameleon,
          playerOrder: lobby.playerOrder,
          currentPlayer: lobby.playerOrder[0],
          roundEndTime: Date.now() + 60000,
        });
      });

      console.log(`Game started in lobby ${code}`);
    });

    socket.on('submit-clue', ({ code, clue }: { code: string; clue: string }) => {
      const lobby = lobbies.get(code);
      if (!lobby || lobby.state !== 'playing') return;

      const currentPlayer = lobby.playerOrder[lobby.currentPlayerIndex];
      if (currentPlayer.id !== socket.id) return;

      const player = lobby.players.find((p) => p.id === socket.id);
      if (!player) return;

      player.clue = clue;

      io.to(code).emit('clue-submitted', {
        playerId: socket.id,
        playerName: player.name,
        clue,
        clues: lobby.players.map((p) => ({ id: p.id, name: p.name, clue: p.clue })),
      });

      lobby.currentPlayerIndex++;
      if (lobby.currentPlayerIndex < lobby.playerOrder.length) {
        io.to(code).emit('next-player', {
          currentPlayer: lobby.playerOrder[lobby.currentPlayerIndex],
          roundEndTime: Date.now() + 60000,
        });
      } else {
        startVoting(lobby);
      }
    });

    function startVoting(lobby: Lobby) {
      lobby.state = 'voting';
      const clues = lobby.players.map((p) => ({
        id: p.id,
        name: p.name,
        clue: p.clue || '(skipped)',
      }));

      io.to(lobby.code).emit('voting-phase', {
        clues,
        roundEndTime: Date.now() + 60000,
      });
    }

    socket.on('submit-vote', ({ code, votedPlayerId }: { code: string; votedPlayerId: string }) => {
      const lobby = lobbies.get(code);
      if (!lobby || lobby.state !== 'voting') return;

      const player = lobby.players.find((p) => p.id === socket.id);
      if (!player || player.hasVoted) return;

      player.vote = votedPlayerId;
      player.hasVoted = true;

      const votesCount = lobby.players.filter((p) => p.hasVoted).length;
      io.to(code).emit('vote-cast', { votesCount, totalPlayers: lobby.players.length });

      if (votesCount === lobby.players.length) {
        showResults(lobby, io);
      }
    });

    function showResults(lobby: Lobby, io: Server) {
      const voteCounts: Record<string, number> = {};
      lobby.players.forEach((p) => {
        if (p.vote) {
          voteCounts[p.vote] = (voteCounts[p.vote] || 0) + 1;
        }
      });

      let mostVoted = '';
      let maxVotes = 0;
      for (const [playerId, count] of Object.entries(voteCounts)) {
        if (count > maxVotes) {
          maxVotes = count;
          mostVoted = playerId;
        }
      }

      const caughtChameleon = mostVoted === lobby.chameleonId;
      lobby.mostVoted = mostVoted;
      lobby.voteCount = maxVotes;
      lobby.caughtChameleon = caughtChameleon;

      if (caughtChameleon) {
        lobby.state = 'chameleon-guessing';
        const chameleonPlayer = lobby.players.find((p) => p.id === lobby.chameleonId);
        io.to(lobby.code).emit('chameleon-guess-phase', {
          chameleonId: lobby.chameleonId!,
          chameleonName: chameleonPlayer?.name || 'Unknown',
          allWords: lobby.allWords,
          category: lobby.category!,
        });
      } else {
        lobby.chameleonGuessedCorrectly = false;
        showFinalResults(lobby, io);
      }
    }

    function showFinalResults(lobby: Lobby, io: Server) {
      lobby.state = 'results';
      const chameleonPlayer = lobby.players.find((p) => p.id === lobby.chameleonId);
      const mostVotedPlayer = lobby.players.find((p) => p.id === lobby.mostVoted);

      const votes = lobby.players.map((p) => ({
        name: p.name,
        votedFor: lobby.players.find((v) => v.id === p.vote)?.name || 'no one',
      }));

      io.to(lobby.code).emit('game-results', {
        chameleonId: lobby.chameleonId!,
        chameleonName: chameleonPlayer?.name || 'Unknown',
        secretWord: lobby.secretWord!,
        caughtChameleon: lobby.caughtChameleon,
        chameleonGuess: lobby.chameleonGuess,
        chameleonGuessedCorrectly: lobby.chameleonGuessedCorrectly,
        mostVotedName: mostVotedPlayer?.name || 'Unknown',
        votes,
        voteCount: lobby.voteCount,
      });
    }

    socket.on('chameleon-guess', ({ code, guess }: { code: string; guess: string }) => {
      const lobby = lobbies.get(code);
      if (!lobby || lobby.state !== 'chameleon-guessing') return;
      if (socket.id !== lobby.chameleonId) return;

      lobby.chameleonGuess = guess;
      lobby.chameleonGuessedCorrectly =
        guess.toLowerCase().trim() === lobby.secretWord?.toLowerCase().trim();

      showFinalResults(lobby, io);
    });

    socket.on('play-again', (code: string) => {
      const lobby = lobbies.get(code);
      if (!lobby) return;
      if (lobby.host !== socket.id) return;

      lobby.state = 'waiting';
      lobby.category = null;
      lobby.secretWord = null;
      lobby.allWords = [];
      lobby.chameleonId = null;
      lobby.playerOrder = [];
      lobby.currentPlayerIndex = 0;
      lobby.roundEndTime = null;
      lobby.mostVoted = null;
      lobby.voteCount = 0;
      lobby.caughtChameleon = false;
      lobby.chameleonGuess = null;
      lobby.chameleonGuessedCorrectly = false;

      lobby.players.forEach((p) => {
        p.clue = null;
        p.vote = null;
        p.hasVoted = false;
      });

      io.to(code).emit('reset-lobby', { players: lobby.players });
    });

    socket.on('disconnect', () => {
      const socketId = socket.id;

      for (const [code, lobby] of lobbies) {
        const playerIndex = lobby.players.findIndex((p) => p.id === socketId);
        if (playerIndex !== -1) {
          const player = lobby.players[playerIndex];
          const playerName = player.name;

          player.disconnectedAt = Date.now();
          player.disconnectedSocketId = socketId;

          setTimeout(() => {
            const currentPlayer = lobby.players.find((p) => p.name === playerName);
            if (currentPlayer && currentPlayer.disconnectedSocketId === socketId) {
              const idx = lobby.players.findIndex((p) => p.name === playerName);
              if (idx !== -1) {
                lobby.players.splice(idx, 1);

                if (lobby.players.length === 0) {
                  lobbies.delete(code);
                  console.log(`Lobby ${code} deleted (empty after disconnect)`);
                  return;
                }

                if (currentPlayer.isHost && lobby.players.length > 0) {
                  lobby.players[0].isHost = true;
                  lobby.host = lobby.players[0].id;
                }

                if (lobby.state !== 'waiting') {
                  lobby.state = 'waiting';
                  lobby.category = null;
                  lobby.secretWord = null;
                  lobby.allWords = [];
                  lobby.chameleonId = null;
                  lobby.playerOrder = [];
                  lobby.currentPlayerIndex = 0;
                  io.to(code).emit('game-interrupted', {
                    reason: `${playerName} left the game`,
                    players: lobby.players,
                  });
                } else {
                  io.to(code).emit('player-left', {
                    players: lobby.players,
                    leftPlayer: playerName,
                  });
                }
              }
            }
          }, 5000);

          break;
        }
      }

      console.log('Player disconnected:', socketId);
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
