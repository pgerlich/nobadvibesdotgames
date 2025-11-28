"use client";

import type {
  ChameleonGuessPhasePayload,
  GameResultsPayload,
  GameStartedPayload,
  GameState,
  Player,
  VotingPhasePayload,
} from "@/types/game";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { io, Socket } from "socket.io-client";

interface GameContextType {
  // Connection
  socket: Socket | null;
  isConnected: boolean;
  connectionStatus: string | null;

  // Player state
  myName: string;
  setMyName: (name: string) => void;
  isHost: boolean;
  isChameleon: boolean;

  // Lobby state
  lobbyCode: string;
  players: Player[];
  gameState: GameState;

  // Game state
  category: string;
  secretWord: string | null;
  allWords: string[];
  playerOrder: Player[];
  currentPlayer: Player | null;
  clues: Array<{ id: string; name: string; clue: string | null }>;

  // Voting
  votesCount: number;
  selectedVote: string | null;
  setSelectedVote: (id: string | null) => void;

  // Results
  gameResults: GameResultsPayload | null;
  guessPhaseData: ChameleonGuessPhasePayload | null;

  // Actions
  createLobby: (name: string) => void;
  joinLobby: (code: string, name: string) => void;
  leaveLobby: () => void;
  startGame: () => void;
  submitClue: (clue: string) => void;
  submitVote: () => void;
  submitGuess: (guess: string) => void;
  playAgain: () => void;

  // Error handling
  error: string | null;
  clearError: () => void;
}

const GameContext = createContext<GameContextType | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);

  const [myName, setMyName] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [isChameleon, setIsChameleon] = useState(false);

  const [lobbyCode, setLobbyCode] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<GameState>("waiting");

  const [category, setCategory] = useState("");
  const [secretWord, setSecretWord] = useState<string | null>(null);
  const [allWords, setAllWords] = useState<string[]>([]);
  const [playerOrder, setPlayerOrder] = useState<Player[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [clues, setClues] = useState<
    Array<{ id: string; name: string; clue: string | null }>
  >([]);

  const [votesCount, setVotesCount] = useState(0);
  const [selectedVote, setSelectedVote] = useState<string | null>(null);

  const [gameResults, setGameResults] = useState<GameResultsPayload | null>(
    null
  );
  const [guessPhaseData, setGuessPhaseData] =
    useState<ChameleonGuessPhasePayload | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Session management
  const saveSession = useCallback(() => {
    if (lobbyCode && myName) {
      const url = new URL(window.location.href);
      url.searchParams.set("room", lobbyCode);
      url.searchParams.set("name", myName);
      window.history.replaceState({}, "", url);
      localStorage.setItem(
        "undercover_session",
        JSON.stringify({
          lobbyCode,
          playerName: myName,
          timestamp: Date.now(),
        })
      );
    }
  }, [lobbyCode, myName]);

  const clearSession = useCallback(() => {
    localStorage.removeItem("undercover_session");
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    url.searchParams.delete("name");
    window.history.replaceState({}, "", url);
  }, []);

  const loadSession = useCallback(() => {
    if (typeof window === "undefined") return null;

    const url = new URL(window.location.href);
    const roomFromUrl = url.searchParams.get("room");
    const nameFromUrl = url.searchParams.get("name");

    if (roomFromUrl && nameFromUrl) {
      return { lobbyCode: roomFromUrl.toUpperCase(), playerName: nameFromUrl };
    }

    try {
      const data = localStorage.getItem("undercover_session");
      if (data) {
        const session = JSON.parse(data);
        if (Date.now() - session.timestamp < 2 * 60 * 60 * 1000) {
          return session;
        }
      }
    } catch {}
    return null;
  }, []);

  // Initialize socket
  useEffect(() => {
    // In production, connect to the WebSocket server URL
    // In development, connect to the same host
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || undefined;
    
    const newSocket = io(wsUrl, {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ["websocket", "polling"],
    });

    setSocket(newSocket);

    newSocket.on("connect", () => {
      setIsConnected(true);
      setConnectionStatus(null);

      // Try to rejoin
      const session = loadSession();
      if (session) {
        setConnectionStatus(`Reconnecting to ${session.lobbyCode}...`);
        newSocket.emit("rejoin-lobby", {
          code: session.lobbyCode,
          playerName: session.playerName,
        });
      }
    });

    newSocket.on("disconnect", () => {
      setIsConnected(false);
      setConnectionStatus("Connection lost. Reconnecting...");
    });

    newSocket.on("reconnect_attempt", (attemptNumber) => {
      setConnectionStatus(`Reconnecting... (attempt ${attemptNumber})`);
    });

    newSocket.on("reconnect_failed", () => {
      setConnectionStatus("Connection failed. Please refresh the page.");
    });

    newSocket.on("error", (message: string) => {
      setError(message);
      setTimeout(() => setError(null), 3000);
    });

    newSocket.on("lobby-created", ({ code, players }) => {
      setLobbyCode(code);
      setPlayers(players);
      setIsHost(true);
      setGameState("waiting");
    });

    newSocket.on("lobby-joined", ({ code, players }) => {
      setLobbyCode(code);
      setPlayers(players);
      setIsHost(false);
      setGameState("waiting");
    });

    newSocket.on(
      "rejoin-success",
      ({ code, players, state, isHost: hostStatus }) => {
        setLobbyCode(code);
        setPlayers(players);
        setIsHost(hostStatus);
        setGameState(state);
        setConnectionStatus(null);
      }
    );

    newSocket.on("rejoin-failed", () => {
      setConnectionStatus(null);
      clearSession();
    });

    newSocket.on("player-joined", ({ players }) => {
      setPlayers(players);
    });

    newSocket.on("player-left", ({ players }) => {
      setPlayers(players);
      // Check if we became host
      const me = players.find((p: Player) => p.name === myName);
      if (me?.isHost && !isHost) {
        setIsHost(true);
      }
    });

    newSocket.on("game-started", (data: GameStartedPayload) => {
      setGameState("playing");
      setCategory(data.category);
      setSecretWord(data.secretWord);
      setAllWords(data.allWords);
      setIsChameleon(data.isChameleon);
      setPlayerOrder(data.playerOrder);
      setCurrentPlayer(data.currentPlayer);
      setClues(
        data.playerOrder.map((p) => ({ id: p.id, name: p.name, clue: null }))
      );
      setGameResults(null);
      setGuessPhaseData(null);
    });

    newSocket.on("next-player", ({ currentPlayer }) => {
      setCurrentPlayer(currentPlayer);
    });

    newSocket.on("clue-submitted", ({ playerId, clue }) => {
      setClues((prev) =>
        prev.map((c) => (c.id === playerId ? { ...c, clue } : c))
      );
    });

    newSocket.on("voting-phase", (data: VotingPhasePayload) => {
      setGameState("voting");
      setClues(data.clues.map((c) => ({ ...c, clue: c.clue })));
      setSelectedVote(null);
      setVotesCount(0);
    });

    newSocket.on("vote-cast", ({ votesCount }) => {
      setVotesCount(votesCount);
    });

    newSocket.on(
      "chameleon-guess-phase",
      (data: ChameleonGuessPhasePayload) => {
        setGameState("chameleon-guessing");
        setGuessPhaseData(data);
      }
    );

    newSocket.on("game-results", (data: GameResultsPayload) => {
      setGameState("results");
      setGameResults(data);
    });

    newSocket.on("reset-lobby", ({ players }) => {
      setPlayers(players);
      setGameState("waiting");
      setCategory("");
      setSecretWord(null);
      setAllWords([]);
      setIsChameleon(false);
      setPlayerOrder([]);
      setCurrentPlayer(null);
      setClues([]);
      setGameResults(null);
      setGuessPhaseData(null);
    });

    newSocket.on("game-interrupted", ({ reason, players }) => {
      setError(`Game ended: ${reason}`);
      setPlayers(players);
      setGameState("waiting");
    });

    return () => {
      newSocket.close();
    };
  }, []);

  // Save session when lobby code or name changes
  useEffect(() => {
    if (lobbyCode && myName) {
      saveSession();
    }
  }, [lobbyCode, myName, saveSession]);

  // Actions
  const createLobby = useCallback(
    (name: string) => {
      setMyName(name);
      socket?.emit("create-lobby", name);
    },
    [socket]
  );

  const joinLobby = useCallback(
    (code: string, name: string) => {
      setMyName(name);
      socket?.emit("join-lobby", {
        code: code.toUpperCase(),
        playerName: name,
      });
    },
    [socket]
  );

  const leaveLobby = useCallback(() => {
    socket?.emit("leave-lobby", lobbyCode);
    clearSession();
    setLobbyCode("");
    setPlayers([]);
    setIsHost(false);
    setGameState("waiting");
  }, [socket, lobbyCode, clearSession]);

  const startGame = useCallback(() => {
    socket?.emit("start-game", lobbyCode);
  }, [socket, lobbyCode]);

  const submitClue = useCallback(
    (clue: string) => {
      socket?.emit("submit-clue", { code: lobbyCode, clue });
    },
    [socket, lobbyCode]
  );

  const submitVote = useCallback(() => {
    if (selectedVote) {
      socket?.emit("submit-vote", {
        code: lobbyCode,
        votedPlayerId: selectedVote,
      });
    }
  }, [socket, lobbyCode, selectedVote]);

  const submitGuess = useCallback(
    (guess: string) => {
      socket?.emit("chameleon-guess", { code: lobbyCode, guess });
    },
    [socket, lobbyCode]
  );

  const playAgain = useCallback(() => {
    socket?.emit("play-again", lobbyCode);
  }, [socket, lobbyCode]);

  const clearError = useCallback(() => setError(null), []);

  return (
    <GameContext.Provider
      value={{
        socket,
        isConnected,
        connectionStatus,
        myName,
        setMyName,
        isHost,
        isChameleon,
        lobbyCode,
        players,
        gameState,
        category,
        secretWord,
        allWords,
        playerOrder,
        currentPlayer,
        clues,
        votesCount,
        selectedVote,
        setSelectedVote,
        gameResults,
        guessPhaseData,
        createLobby,
        joinLobby,
        leaveLobby,
        startGame,
        submitClue,
        submitVote,
        submitGuess,
        playAgain,
        error,
        clearError,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return context;
}
