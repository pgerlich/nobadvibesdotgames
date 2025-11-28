import 'dotenv/config';
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { sessionService, lobbyService, gameService } from './src/lib/services';
import type { LobbyPlayer } from './src/lib/services';
import redis from './src/lib/redis';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  // Connect to Redis
  await redis.connect();
  console.log('Redis connected');

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

  // Helper to format players for client
  function formatPlayersForClient(players: LobbyPlayer[]) {
    return players.map(p => ({
      id: p.socketId, // Client uses socket ID as player ID
      name: p.name,
      isHost: p.isHost,
      clue: null,
      vote: null,
      hasVoted: false,
    }));
  }

  io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    let currentPlayerId: string | null = null;
    let currentLobbyCode: string | null = null;

    socket.on('create-lobby', async (playerName: string) => {
      try {
        // Create or get player
        const visitorId = socket.handshake.query.visitorId as string | undefined;
        const { id: playerId } = await sessionService.getOrCreatePlayer(visitorId, playerName);
        currentPlayerId = playerId;

        // Create lobby
        const { lobby, player } = await lobbyService.createLobby(
          playerId,
          socket.id,
          playerName,
          'undercover'
        );
        currentLobbyCode = lobby.code;

        // Register socket
        await sessionService.registerSocket(socket.id, playerId, playerName, lobby.code);

        socket.join(lobby.code);
        socket.emit('lobby-created', {
          code: lobby.code,
          players: formatPlayersForClient([player]),
        });

        console.log(`Lobby ${lobby.code} created by ${playerName}`);
      } catch (error) {
        console.error('Error creating lobby:', error);
        socket.emit('error', 'Failed to create lobby');
      }
    });

    socket.on('join-lobby', async ({ code, playerName }: { code: string; playerName: string }) => {
      try {
        // Create or get player
        const visitorId = socket.handshake.query.visitorId as string | undefined;
        const { id: playerId } = await sessionService.getOrCreatePlayer(visitorId, playerName);
        currentPlayerId = playerId;

        // Join lobby
        const result = await lobbyService.joinLobby(code, playerId, socket.id, playerName);
        if (!result) {
          socket.emit('error', 'Unable to join lobby');
          return;
        }

        currentLobbyCode = result.lobby.code;

        // Register socket
        await sessionService.registerSocket(socket.id, playerId, playerName, result.lobby.code);

        socket.join(result.lobby.code);
        socket.emit('lobby-joined', {
          code: result.lobby.code,
          players: formatPlayersForClient(result.players),
        });

        // Notify others
        io.to(result.lobby.code).emit('player-joined', {
          players: formatPlayersForClient(result.players),
        });

        console.log(`${playerName} joined lobby ${code}`);
      } catch (error) {
        console.error('Error joining lobby:', error);
        socket.emit('error', 'Failed to join lobby');
      }
    });

    socket.on('rejoin-lobby', async ({ code, playerName }: { code: string; playerName: string }) => {
      try {
        // Get or create player
        const visitorId = socket.handshake.query.visitorId as string | undefined;
        const { id: playerId } = await sessionService.getOrCreatePlayer(visitorId, playerName);
        currentPlayerId = playerId;

        // Check for reconnection data
        const reconnectData = await sessionService.getReconnectionData(playerId);
        
        // Try to reconnect to existing lobby
        const result = await lobbyService.handlePlayerReconnect(code.toUpperCase(), playerId, socket.id);
        
        if (result) {
          currentLobbyCode = result.lobby.code;
          await sessionService.clearReconnection(playerId);
          await sessionService.registerSocket(socket.id, playerId, playerName, result.lobby.code);

          socket.join(result.lobby.code);
          socket.emit('rejoin-success', {
            code: result.lobby.code,
            players: formatPlayersForClient(result.players),
            state: result.lobby.status,
            isHost: result.player.isHost,
          });

          console.log(`${playerName} rejoined lobby ${code}`);
          return;
        }

        // Try joining as new player if lobby is in waiting state
        const joinResult = await lobbyService.joinLobby(code, playerId, socket.id, playerName);
        if (joinResult && joinResult.lobby.status === 'waiting') {
          currentLobbyCode = joinResult.lobby.code;
          await sessionService.registerSocket(socket.id, playerId, playerName, joinResult.lobby.code);

          socket.join(joinResult.lobby.code);
          socket.emit('rejoin-success', {
            code: joinResult.lobby.code,
            players: formatPlayersForClient(joinResult.players),
            state: 'waiting',
            isHost: joinResult.player.isHost,
          });

          io.to(joinResult.lobby.code).emit('player-joined', {
            players: formatPlayersForClient(joinResult.players),
          });

          console.log(`${playerName} joined lobby ${code} via rejoin`);
          return;
        }

        socket.emit('rejoin-failed');
      } catch (error) {
        console.error('Error rejoining lobby:', error);
        socket.emit('rejoin-failed');
      }
    });

    socket.on('leave-lobby', async (code: string) => {
      try {
        if (!currentPlayerId) return;

        const result = await lobbyService.leaveLobby(code, currentPlayerId);
        
        socket.leave(code);
        await sessionService.setPlayerLobby(currentPlayerId, null);
        currentLobbyCode = null;

        if (!result.lobbyDeleted) {
          io.to(code).emit('player-left', {
            players: formatPlayersForClient(result.remainingPlayers),
            leftPlayer: '',
          });
        }
      } catch (error) {
        console.error('Error leaving lobby:', error);
      }
    });

    socket.on('start-game', async (code: string) => {
      try {
        const lobby = await lobbyService.getLobbyState(code);
        if (!lobby || lobby.hostSocketId !== socket.id) return;

        const result = await gameService.startGame(code);
        if (!result) return;

        const players = await lobbyService.getLobbyPlayers(code);

        // Send personalized game start to each player
        for (const player of players) {
          const isChameleon = player.id === result.chameleonId;
          io.to(player.socketId).emit('game-started', {
            category: result.category,
            allWords: result.allWords,
            secretWord: isChameleon ? null : result.secretWord,
            isChameleon,
            playerOrder: formatPlayersForClient(result.playerOrder),
            currentPlayer: {
              id: result.playerOrder[0].socketId,
              name: result.playerOrder[0].name,
            },
            roundEndTime: Date.now() + 60000,
          });
        }

        console.log(`Game started in lobby ${code}`);
      } catch (error) {
        console.error('Error starting game:', error);
        socket.emit('error', 'Failed to start game');
      }
    });

    socket.on('submit-clue', async ({ code, clue }: { code: string; clue: string }) => {
      try {
        if (!currentPlayerId) return;

        const result = await gameService.submitClue(code, currentPlayerId, clue);
        if (!result.success) return;

        const players = await lobbyService.getLobbyPlayers(code);
        const player = players.find(p => p.id === currentPlayerId);

        // Broadcast clue to all players
        io.to(code).emit('clue-submitted', {
          playerId: socket.id,
          playerName: player?.name || 'Unknown',
          clue,
          clues: [],
        });

        if (result.allCluesSubmitted) {
          // Start voting phase
          const lobby = await lobbyService.getLobbyState(code);
          const clues = players.map(p => ({
            id: p.socketId,
            name: p.name,
            clue: lobby?.clues?.[p.id] || '(skipped)',
          }));

          io.to(code).emit('voting-phase', {
            clues,
            roundEndTime: Date.now() + 60000,
          });
        } else if (result.nextPlayerId) {
          // Notify next player's turn
          const nextPlayer = players.find(p => p.id === result.nextPlayerId);
          io.to(code).emit('next-player', {
            currentPlayer: {
              id: nextPlayer?.socketId || '',
              name: nextPlayer?.name || 'Unknown',
            },
            roundEndTime: Date.now() + 60000,
          });
        }
      } catch (error) {
        console.error('Error submitting clue:', error);
        socket.emit('error', 'Failed to submit clue');
      }
    });

    socket.on('submit-vote', async ({ code, votedPlayerId }: { code: string; votedPlayerId: string }) => {
      try {
        if (!currentPlayerId) return;

        // Find the actual player ID from socket ID
        const players = await lobbyService.getLobbyPlayers(code);
        const targetPlayer = players.find(p => p.socketId === votedPlayerId);
        if (!targetPlayer) return;

        const result = await gameService.submitVote(code, currentPlayerId, targetPlayer.id);
        if (!result.success) return;

        io.to(code).emit('vote-cast', {
          votesCount: result.votesCount,
          totalPlayers: players.length,
        });

        if (result.allVotesIn && result.voteResult) {
          if (result.voteResult.isChameleon) {
            // Chameleon was caught - give them a chance to guess
            const chameleonPlayer = players.find(p => p.id === result.voteResult!.mostVotedId);
            const lobby = await lobbyService.getLobbyState(code);

            io.to(code).emit('chameleon-guess-phase', {
              chameleonId: chameleonPlayer?.socketId || '',
              chameleonName: result.voteResult.mostVotedName,
              allWords: lobby?.allWords || [],
              category: lobby?.category || '',
            });
          } else {
            // Chameleon escaped - show results
            const gameResult = await gameService.getResults(code);
            if (gameResult) {
              const chameleonPlayer = players.find(p => p.id === gameResult.chameleonId);
              io.to(code).emit('game-results', {
                chameleonId: chameleonPlayer?.socketId || '',
                chameleonName: gameResult.chameleonName,
                secretWord: gameResult.secretWord,
                caughtChameleon: false,
                chameleonGuess: null,
                chameleonGuessedCorrectly: false,
                mostVotedName: result.voteResult.mostVotedName,
                votes: gameResult.votes,
                voteCount: result.voteResult.voteCount,
              });
            }
          }
        }
      } catch (error) {
        console.error('Error submitting vote:', error);
        socket.emit('error', 'Failed to submit vote');
      }
    });

    socket.on('chameleon-guess', async ({ code, guess }: { code: string; guess: string }) => {
      try {
        const lobby = await lobbyService.getLobbyState(code);
        if (!lobby || !currentPlayerId || currentPlayerId !== lobby.chameleonId) return;

        const result = await gameService.submitGuess(code, guess);
        if (!result) return;

        const players = await lobbyService.getLobbyPlayers(code);
        const chameleonPlayer = players.find(p => p.id === result.chameleonId);

        io.to(code).emit('game-results', {
          chameleonId: chameleonPlayer?.socketId || '',
          chameleonName: result.chameleonName,
          secretWord: result.secretWord,
          caughtChameleon: true,
          chameleonGuess: result.chameleonGuess,
          chameleonGuessedCorrectly: result.chameleonGuessedCorrectly,
          mostVotedName: result.chameleonName,
          votes: result.votes,
          voteCount: 0,
        });
      } catch (error) {
        console.error('Error submitting guess:', error);
        socket.emit('error', 'Failed to submit guess');
      }
    });

    socket.on('play-again', async (code: string) => {
      try {
        const lobby = await lobbyService.getLobbyState(code);
        if (!lobby || lobby.hostSocketId !== socket.id) return;

        const result = await gameService.resetLobby(code);
        if (!result) return;

        io.to(code).emit('reset-lobby', {
          players: formatPlayersForClient(result.players),
        });
      } catch (error) {
        console.error('Error resetting lobby:', error);
        socket.emit('error', 'Failed to reset lobby');
      }
    });

    socket.on('disconnect', async () => {
      console.log('Player disconnected:', socket.id);

      try {
        // Handle disconnect - queue for potential reconnection
        const session = await sessionService.handleDisconnect(socket.id);
        
        if (session && currentLobbyCode) {
          // Mark player as disconnected in lobby
          await lobbyService.handlePlayerDisconnect(currentLobbyCode, session.playerId);

          // Wait for grace period then check if player reconnected
          setTimeout(async () => {
            const reconnectData = await sessionService.getReconnectionData(session.playerId);
            if (reconnectData) {
              // Player didn't reconnect - remove from lobby
              const result = await lobbyService.leaveLobby(currentLobbyCode!, session.playerId);
              
              if (!result.lobbyDeleted) {
                const lobby = await lobbyService.getLobbyState(currentLobbyCode!);
                
                if (lobby && lobby.status !== 'waiting') {
                  // Game interrupted
                  io.to(currentLobbyCode!).emit('game-interrupted', {
                    reason: `${session.playerName} left the game`,
                    players: formatPlayersForClient(result.remainingPlayers),
                  });
                  
                  // Reset to waiting state
                  await gameService.resetLobby(currentLobbyCode!);
                } else {
                  io.to(currentLobbyCode!).emit('player-left', {
                    players: formatPlayersForClient(result.remainingPlayers),
                    leftPlayer: session.playerName,
                  });
                }
              }

              await sessionService.clearReconnection(session.playerId);
            }
          }, 5000); // 5 second grace period
        }
      } catch (error) {
        console.error('Error handling disconnect:', error);
      }
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
