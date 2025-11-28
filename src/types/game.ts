// Game Types

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  clue: string | null;
  vote: string | null;
  hasVoted: boolean;
  disconnectedAt?: number;
  disconnectedSocketId?: string;
}

export interface Lobby {
  code: string;
  host: string;
  players: Player[];
  state: GameState;
  category: string | null;
  secretWord: string | null;
  allWords: string[];
  chameleonId: string | null;
  playerOrder: Player[];
  currentPlayerIndex: number;
  roundEndTime: number | null;
  mostVoted: string | null;
  voteCount: number;
  caughtChameleon: boolean;
  chameleonGuess: string | null;
  chameleonGuessedCorrectly: boolean;
}

export type GameState =
  | "waiting"
  | "playing"
  | "voting"
  | "chameleon-guessing"
  | "results";

export interface GameStartedPayload {
  category: string;
  allWords: string[];
  secretWord: string | null;
  isChameleon: boolean;
  playerOrder: Player[];
  currentPlayer: Player;
  roundEndTime: number;
}

export interface VotingPhasePayload {
  clues: Array<{ id: string; name: string; clue: string }>;
  roundEndTime: number;
}

export interface GameResultsPayload {
  chameleonId: string;
  chameleonName: string;
  secretWord: string;
  caughtChameleon: boolean;
  chameleonGuess: string | null;
  chameleonGuessedCorrectly: boolean;
  mostVotedName: string;
  votes: Array<{ name: string; votedFor: string }>;
  voteCount: number;
}

export interface ChameleonGuessPhasePayload {
  chameleonId: string;
  chameleonName: string;
  allWords: string[];
  category: string;
}

// Socket Events
export interface ServerToClientEvents {
  error: (message: string) => void;
  "lobby-created": (data: { code: string; players: Player[] }) => void;
  "lobby-joined": (data: { code: string; players: Player[] }) => void;
  "player-joined": (data: { players: Player[] }) => void;
  "player-left": (data: { players: Player[]; leftPlayer: string }) => void;
  "rejoin-success": (data: {
    code: string;
    players: Player[];
    state: GameState;
    isHost: boolean;
  }) => void;
  "rejoin-failed": () => void;
  "game-started": (data: GameStartedPayload) => void;
  "next-player": (data: {
    currentPlayer: Player;
    roundEndTime: number;
  }) => void;
  "clue-submitted": (data: {
    playerId: string;
    playerName: string;
    clue: string;
    clues: any[];
  }) => void;
  "voting-phase": (data: VotingPhasePayload) => void;
  "vote-cast": (data: { votesCount: number; totalPlayers: number }) => void;
  "chameleon-guess-phase": (data: ChameleonGuessPhasePayload) => void;
  "game-results": (data: GameResultsPayload) => void;
  "reset-lobby": (data: { players: Player[] }) => void;
  "game-interrupted": (data: { reason: string; players: Player[] }) => void;
}

export interface ClientToServerEvents {
  "create-lobby": (playerName: string) => void;
  "join-lobby": (data: { code: string; playerName: string }) => void;
  "rejoin-lobby": (data: { code: string; playerName: string }) => void;
  "leave-lobby": (code: string) => void;
  "start-game": (code: string) => void;
  "submit-clue": (data: { code: string; clue: string }) => void;
  "submit-vote": (data: { code: string; votedPlayerId: string }) => void;
  "chameleon-guess": (data: { code: string; guess: string }) => void;
  "play-again": (code: string) => void;
}
