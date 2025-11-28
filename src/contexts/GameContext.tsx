"use client";

import {
  GameState,
  generateLobbyCode,
  generatePlayerId,
  Player,
  startGameRound,
  tallyVotes,
} from "@/lib/game-engine";
import { supabase } from "@/lib/supabase";
import { RealtimeChannel } from "@supabase/supabase-js";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

interface GameContextType {
  // Connection
  isConnected: boolean;
  connectionStatus: string | null;

  // Player state
  myId: string;
  myName: string;
  setMyName: (name: string) => void;
  isHost: boolean;
  isChameleon: boolean;

  // Lobby state
  lobbyCode: string;
  players: Player[];
  gamePhase: GameState["phase"];

  // Game state
  category: string;
  secretWord: string | null;
  allWords: string[];
  playerOrder: string[];
  currentPlayerId: string | null;
  clues: Record<string, string>;

  // Voting
  votesCount: number;
  selectedVote: string | null;
  setSelectedVote: (id: string | null) => void;

  // Results
  gameResults: GameState["results"] | null;
  guessPhaseData: {
    chameleonId: string;
    chameleonName: string;
    allWords: string[];
    category: string;
  } | null;

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
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);

  const [myId, setMyId] = useState("");
  const [myName, setMyName] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [isChameleon, setIsChameleon] = useState(false);

  const [lobbyCode, setLobbyCode] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [gamePhase, setGamePhase] = useState<GameState["phase"]>("waiting");

  const [category, setCategory] = useState("");
  const [secretWord, setSecretWord] = useState<string | null>(null);
  const [allWords, setAllWords] = useState<string[]>([]);
  const [playerOrder, setPlayerOrder] = useState<string[]>([]);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [chameleonId, setChameleonId] = useState<string | null>(null);
  const [clues, setClues] = useState<Record<string, string>>({});

  const [votes, setVotes] = useState<Record<string, string>>({});
  const [votesCount, setVotesCount] = useState(0);
  const [selectedVote, setSelectedVote] = useState<string | null>(null);

  const [gameResults, setGameResults] = useState<GameState["results"] | null>(
    null
  );
  const [guessPhaseData, setGuessPhaseData] = useState<{
    chameleonId: string;
    chameleonName: string;
    allWords: string[];
    category: string;
  } | null>(null);

  const [error, setError] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);

  // Initialize player ID
  useEffect(() => {
    let storedId = localStorage.getItem("player_id");
    if (!storedId) {
      storedId = generatePlayerId();
      localStorage.setItem("player_id", storedId);
    }
    setMyId(storedId);
  }, []);

  const currentPlayerId = playerOrder[currentPlayerIndex] || null;

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

  // Join a Supabase channel for the lobby
  const joinChannel = useCallback(
    (code: string, playerName: string, asHost: boolean) => {
      if (!myId) {
        setError("Still loading, please try again");
        return;
      }

      try {
        if (channelRef.current) {
          supabase.removeChannel(channelRef.current);
        }

        const channel = supabase.channel(`game:${code}`, {
          config: {
            presence: { key: myId },
            broadcast: { self: true },
          },
        });

      // Handle presence (players joining/leaving)
      channel.on("presence", { event: "sync" }, () => {
        const presenceState = channel.presenceState();
        const playerList: Player[] = Object.entries(presenceState).map(
          ([id, data]) => {
            const playerData = (data as any[])[0];
            return {
              id,
              name: playerData.name,
              isHost: playerData.isHost,
              clue: playerData.clue,
            };
          }
        );
        setPlayers(playerList);

        // Check if we're now the host (if original host left)
        if (playerList.length > 0 && !playerList.some((p) => p.isHost)) {
          // No host - first player becomes host
          if (playerList[0].id === myId) {
            setIsHost(true);
            channel.track({ name: playerName, isHost: true });
          }
        }
      });

      // Handle game broadcasts
      channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
        const {
          category,
          allWords,
          secretWord,
          chameleonId: chamId,
          playerOrder: order,
        } = payload;
        setCategory(category);
        setAllWords(allWords);
        setSecretWord(chamId === myId ? null : secretWord);
        setIsChameleon(chamId === myId);
        setChameleonId(chamId);
        setPlayerOrder(order);
        setCurrentPlayerIndex(0);
        setClues({});
        setVotes({});
        setGamePhase("playing");
        setGameResults(null);
        setGuessPhaseData(null);
      });

      channel.on("broadcast", { event: "clue-submitted" }, ({ payload }) => {
        const { playerId, clue, nextIndex } = payload;
        setClues((prev) => ({ ...prev, [playerId]: clue }));
        setCurrentPlayerIndex(nextIndex);
      });

      channel.on("broadcast", { event: "voting-phase" }, ({ payload }) => {
        setClues(payload.clues);
        setGamePhase("voting");
        setVotes({});
        setVotesCount(0);
        setSelectedVote(null);
      });

      channel.on("broadcast", { event: "vote-submitted" }, ({ payload }) => {
        const { votes: newVotes } = payload;
        setVotes(newVotes);
        setVotesCount(Object.keys(newVotes).length);
      });

      channel.on(
        "broadcast",
        { event: "chameleon-guess-phase" },
        ({ payload }) => {
          setGuessPhaseData(payload);
          setGamePhase("chameleon-guessing");
        }
      );

      channel.on("broadcast", { event: "game-results" }, ({ payload }) => {
        setGameResults(payload);
        setGamePhase("results");
      });

      channel.on("broadcast", { event: "play-again" }, () => {
        setGamePhase("waiting");
        setCategory("");
        setSecretWord(null);
        setAllWords([]);
        setIsChameleon(false);
        setPlayerOrder([]);
        setCurrentPlayerIndex(0);
        setClues({});
        setVotes({});
        setGameResults(null);
        setGuessPhaseData(null);
      });

      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setIsConnected(true);
          setConnectionStatus(null);

          // Track presence
          await channel.track({
            name: playerName,
            isHost: asHost,
          });
        } else if (status === "CHANNEL_ERROR") {
          setConnectionStatus("Connection error. Retrying...");
          setError("Failed to connect to game server");
        } else if (status === "TIMED_OUT") {
          setConnectionStatus("Connection timed out. Retrying...");
        }
      });

      channelRef.current = channel;
      setLobbyCode(code);
      setIsHost(asHost);
      setMyName(playerName);
      } catch (err) {
        console.error("Error joining channel:", err);
        setError("Failed to create lobby. Please try again.");
      }
    },
    [myId]
  );

  // Auto-rejoin from session
  useEffect(() => {
    if (!myId) return;

    const url = new URL(window.location.href);
    const roomFromUrl = url.searchParams.get("room");
    const nameFromUrl = url.searchParams.get("name");

    if (roomFromUrl && nameFromUrl) {
      setConnectionStatus(`Rejoining ${roomFromUrl}...`);
      joinChannel(roomFromUrl.toUpperCase(), nameFromUrl, false);
      return;
    }

    try {
      const data = localStorage.getItem("undercover_session");
      if (data) {
        const session = JSON.parse(data);
        if (Date.now() - session.timestamp < 2 * 60 * 60 * 1000) {
          setConnectionStatus(`Rejoining ${session.lobbyCode}...`);
          joinChannel(session.lobbyCode, session.playerName, false);
        }
      }
    } catch {}
  }, [myId, joinChannel]);

  // Save session when lobby code or name changes
  useEffect(() => {
    if (lobbyCode && myName) {
      saveSession();
    }
  }, [lobbyCode, myName, saveSession]);

  // Actions
  const createLobby = useCallback(
    (name: string) => {
      const code = generateLobbyCode();
      joinChannel(code, name, true);
    },
    [joinChannel]
  );

  const joinLobby = useCallback(
    (code: string, name: string) => {
      joinChannel(code.toUpperCase(), name, false);
    },
    [joinChannel]
  );

  const leaveLobby = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    clearSession();
    setLobbyCode("");
    setPlayers([]);
    setIsHost(false);
    setIsConnected(false);
    setGamePhase("waiting");
  }, [clearSession]);

  const startGame = useCallback(() => {
    if (!isHost || players.length < 3) return;

    const gameData = startGameRound(players);

    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: gameData,
    });
  }, [isHost, players]);

  const submitClue = useCallback(
    (clue: string) => {
      if (currentPlayerId !== myId) return;

      const nextIndex = currentPlayerIndex + 1;
      const allCluesSubmitted = nextIndex >= players.length;

      channelRef.current?.send({
        type: "broadcast",
        event: "clue-submitted",
        payload: { playerId: myId, clue, nextIndex },
      });

      if (allCluesSubmitted && isHost) {
        // Gather all clues and transition to voting
        const allClues = { ...clues, [myId]: clue };
        setTimeout(() => {
          channelRef.current?.send({
            type: "broadcast",
            event: "voting-phase",
            payload: { clues: allClues },
          });
        }, 500);
      }
    },
    [currentPlayerId, myId, currentPlayerIndex, players.length, isHost, clues]
  );

  const submitVote = useCallback(() => {
    if (!selectedVote) return;

    const newVotes = { ...votes, [myId]: selectedVote };

    channelRef.current?.send({
      type: "broadcast",
      event: "vote-submitted",
      payload: { votes: newVotes },
    });

    // Check if all votes are in
    if (Object.keys(newVotes).length >= players.length && isHost) {
      setTimeout(() => {
        const { mostVotedId, mostVotedName, voteCount, voteResults } =
          tallyVotes(newVotes, players);
        const isChameleonCaught = mostVotedId === chameleonId;
        const chameleonPlayer = players.find((p) => p.id === chameleonId);

        if (isChameleonCaught) {
          // Give chameleon a chance to guess
          channelRef.current?.send({
            type: "broadcast",
            event: "chameleon-guess-phase",
            payload: {
              chameleonId,
              chameleonName: chameleonPlayer?.name || "Unknown",
              allWords,
              category,
            },
          });
        } else {
          // Chameleon escaped!
          channelRef.current?.send({
            type: "broadcast",
            event: "game-results",
            payload: {
              chameleonId,
              chameleonName: chameleonPlayer?.name || "Unknown",
              secretWord,
              caughtChameleon: false,
              mostVotedId,
              mostVotedName,
              votes: voteResults,
            },
          });
        }
      }, 500);
    }
  }, [
    selectedVote,
    votes,
    myId,
    players,
    isHost,
    chameleonId,
    allWords,
    category,
    secretWord,
  ]);

  const submitGuess = useCallback(
    (guess: string) => {
      if (myId !== chameleonId) return;

      const guessCorrect =
        guess.toLowerCase().trim() === secretWord?.toLowerCase().trim();
      const chameleonPlayer = players.find((p) => p.id === chameleonId);

      channelRef.current?.send({
        type: "broadcast",
        event: "game-results",
        payload: {
          chameleonId,
          chameleonName: chameleonPlayer?.name || "Unknown",
          secretWord,
          caughtChameleon: true,
          chameleonGuess: guess,
          chameleonGuessedCorrectly: guessCorrect,
          votes: Object.entries(votes).map(([casterId, targetId]) => ({
            name: players.find((p) => p.id === casterId)?.name || "Unknown",
            votedFor: players.find((p) => p.id === targetId)?.name || "Unknown",
          })),
        },
      });
    },
    [myId, chameleonId, secretWord, players, votes]
  );

  const playAgain = useCallback(() => {
    if (!isHost) return;

    channelRef.current?.send({
      type: "broadcast",
      event: "play-again",
      payload: {},
    });
  }, [isHost]);

  const clearError = useCallback(() => setError(null), []);

  return (
    <GameContext.Provider
      value={{
        isConnected,
        connectionStatus,
        myId,
        myName,
        setMyName,
        isHost,
        isChameleon,
        lobbyCode,
        players,
        gamePhase,
        category,
        secretWord,
        allWords,
        playerOrder,
        currentPlayerId,
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
