// Game categories and words
export const CATEGORIES: Record<string, string[]> = {
  Animals: [
    "Dog",
    "Cat",
    "Elephant",
    "Giraffe",
    "Lion",
    "Tiger",
    "Bear",
    "Wolf",
    "Fox",
    "Rabbit",
    "Deer",
    "Horse",
  ],
  Food: [
    "Pizza",
    "Burger",
    "Sushi",
    "Pasta",
    "Taco",
    "Salad",
    "Steak",
    "Sandwich",
    "Soup",
    "Curry",
    "Ramen",
    "Burrito",
  ],
  Movies: [
    "Titanic",
    "Avatar",
    "Inception",
    "Jaws",
    "Matrix",
    "Frozen",
    "Shrek",
    "Gladiator",
    "Psycho",
    "Rocky",
    "Alien",
    "Joker",
  ],
  Sports: [
    "Soccer",
    "Basketball",
    "Tennis",
    "Golf",
    "Baseball",
    "Hockey",
    "Cricket",
    "Rugby",
    "Boxing",
    "Swimming",
    "Cycling",
    "Skiing",
  ],
  Countries: [
    "France",
    "Japan",
    "Brazil",
    "Egypt",
    "Canada",
    "Australia",
    "Mexico",
    "Italy",
    "India",
    "Germany",
    "Spain",
    "China",
  ],
  Professions: [
    "Doctor",
    "Teacher",
    "Chef",
    "Pilot",
    "Lawyer",
    "Artist",
    "Engineer",
    "Nurse",
    "Firefighter",
    "Police",
    "Astronaut",
    "Scientist",
  ],
};

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  clue?: string | null;
  hasVoted?: boolean;
}

export interface GameState {
  phase: "waiting" | "playing" | "voting" | "chameleon-guessing" | "results";
  category?: string;
  secretWord?: string;
  allWords?: string[];
  chameleonId?: string;
  playerOrder?: string[];
  currentPlayerIndex?: number;
  clues?: Record<string, string>;
  votes?: Record<string, string>;
  results?: {
    chameleonId: string;
    chameleonName: string;
    secretWord: string;
    caughtChameleon: boolean;
    chameleonGuess?: string;
    chameleonGuessedCorrectly?: boolean;
    mostVotedId?: string;
    mostVotedName?: string;
    votes: Array<{ name: string; votedFor: string }>;
  };
}

export function generateLobbyCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function generatePlayerId(): string {
  return `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function startGameRound(players: Player[]): {
  category: string;
  secretWord: string;
  allWords: string[];
  chameleonId: string;
  playerOrder: string[];
} {
  // Select random category and word
  const categoryNames = Object.keys(CATEGORIES);
  const category =
    categoryNames[Math.floor(Math.random() * categoryNames.length)];
  const words = CATEGORIES[category];
  const secretWord = words[Math.floor(Math.random() * words.length)];

  // Select random chameleon
  const chameleonIndex = Math.floor(Math.random() * players.length);
  const chameleonId = players[chameleonIndex].id;

  // Shuffle player order
  const playerOrder = shuffleArray(players.map((p) => p.id));

  return {
    category,
    secretWord,
    allWords: words,
    chameleonId,
    playerOrder,
  };
}

export function tallyVotes(
  votes: Record<string, string>,
  players: Player[]
): {
  mostVotedId: string;
  mostVotedName: string;
  voteCount: number;
  voteResults: Array<{ name: string; votedFor: string }>;
} {
  const voteTally: Record<string, number> = {};

  for (const targetId of Object.values(votes)) {
    voteTally[targetId] = (voteTally[targetId] || 0) + 1;
  }

  let mostVotedId = "";
  let maxVotes = 0;
  for (const [id, count] of Object.entries(voteTally)) {
    if (count > maxVotes) {
      maxVotes = count;
      mostVotedId = id;
    }
  }

  const mostVotedPlayer = players.find((p) => p.id === mostVotedId);

  const voteResults = Object.entries(votes).map(([casterId, targetId]) => ({
    name: players.find((p) => p.id === casterId)?.name || "Unknown",
    votedFor: players.find((p) => p.id === targetId)?.name || "Unknown",
  }));

  return {
    mostVotedId,
    mostVotedName: mostVotedPlayer?.name || "Unknown",
    voteCount: maxVotes,
    voteResults,
  };
}
