"use client";

import { useGame } from "@/contexts/GameContext";
import { useState, useEffect } from "react";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Role Reveal Phase
function RolePhase({ onReady }: { onReady: () => void }) {
  const { isChameleon, category, secretWord, allWords } = useGame();

  return (
    <div className="text-center p-6">
      <div className="text-6xl mb-4 animate-bounce">
        {isChameleon ? "🕵️" : "🔍"}
      </div>
      <h2
        className={`text-2xl font-bold mb-2 ${
          isChameleon ? "text-orange-400" : "text-green-400"
        }`}
      >
        {isChameleon ? "You are Undercover!" : "You know the word!"}
      </h2>

      <p className="text-gray-400 mb-2">
        Category: <strong className="text-white">{category}</strong>
      </p>

      <div className="inline-block bg-green-400/10 rounded-xl px-8 py-4 my-4">
        <span className="text-3xl font-bold text-emerald-300">
          {secretWord || "???"}
        </span>
      </div>

      <p className="text-gray-400 text-sm mb-6">
        {isChameleon
          ? "Blend in! Give a clue that sounds like you know the word."
          : "Give a clue that proves you know the word, but don't make it too obvious!"}
      </p>

      <div className="grid grid-cols-3 gap-2 bg-gray-900 rounded-xl p-4 mb-6">
        {allWords.map((word) => (
          <div
            key={word}
            className="p-2 text-center text-sm bg-gray-800 rounded-lg border border-gray-700"
          >
            {word}
          </div>
        ))}
      </div>

      <button onClick={onReady} className="btn-primary">
        I&apos;m Ready!
      </button>
    </div>
  );
}

// Clue Phase
function CluePhase() {
  const {
    myId,
    category,
    secretWord,
    allWords,
    playerOrder,
    currentPlayerId,
    players,
    clues,
    submitClue,
  } = useGame();
  const [clue, setClue] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const isMyTurn = currentPlayerId === myId;
  const currentPlayerName = players.find(p => p.id === currentPlayerId)?.name || "...";

  // Reset submission state when turn changes
  useEffect(() => {
    if (currentPlayerId === myId) {
      setHasSubmitted(false);
      setClue("");
    }
  }, [currentPlayerId, myId]);

  const handleSubmit = () => {
    if (clue.trim()) {
      submitClue(clue.trim());
      setHasSubmitted(true);
    }
  };

  // Convert clues record to display format
  const cluesList = playerOrder.map(playerId => {
    const player = players.find(p => p.id === playerId);
    return {
      id: playerId,
      name: player?.name || "Unknown",
      clue: clues[playerId] || null,
    };
  });

  return (
    <div>
      <h2 className="text-xl font-semibold text-center mb-4">Give Your Clue</h2>

      <p className="text-center text-gray-400 mb-2">
        Category: <strong className="text-white">{category}</strong>
      </p>

      {secretWord ? (
        <div className="text-center mb-4">
          <span className="inline-block bg-green-400/10 rounded-lg px-4 py-2 text-emerald-300 font-semibold">
            Secret: {secretWord}
          </span>
        </div>
      ) : (
        <p className="text-center text-orange-400 mb-4">
          🕵️ You&apos;re Undercover - blend in!
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 bg-gray-900 rounded-xl p-3 mb-6">
        {allWords.map((word) => (
          <div
            key={word}
            className="p-2 text-center text-xs bg-gray-800 rounded-lg border border-gray-700"
          >
            {word}
          </div>
        ))}
      </div>

      <div
        className={`p-4 rounded-xl mb-4 text-center border ${
          isMyTurn
            ? "bg-orange-400/20 border-orange-400"
            : "bg-green-400/10 border-green-400"
        }`}
      >
        <h3 className="font-semibold mb-1">
          {isMyTurn ? "🎯 Your Turn!" : `${currentPlayerName}'s turn`}
        </h3>
        <p className="text-sm text-gray-400">
          {isMyTurn ? "Give your one-word clue!" : "Waiting for their clue..."}
        </p>
      </div>

      {isMyTurn && !hasSubmitted && (
        <div className="mb-6">
          <label className="block text-sm text-gray-400 mb-2">
            Your one-word clue:
          </label>
          <input
            type="text"
            value={clue}
            onChange={(e) => setClue(e.target.value)}
            placeholder="Enter your clue..."
            maxLength={30}
            className="input-field mb-3"
            onKeyPress={(e) => e.key === "Enter" && handleSubmit()}
          />
          <button
            onClick={handleSubmit}
            className="btn-primary w-full"
            disabled={!clue.trim()}
          >
            Submit Clue
          </button>
        </div>
      )}

      <h4 className="text-gray-400 text-sm mb-3">Clues Given</h4>
      <ul className="space-y-2">
        {cluesList.map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between p-3 bg-gray-900 rounded-lg border border-gray-700"
          >
            <span className="font-medium">
              {c.name}
              {c.id === myId && " (you)"}
            </span>
            <span
              className={c.clue ? "text-emerald-300 italic" : "text-gray-500"}
            >
              {c.clue ? `"${c.clue}"` : "waiting..."}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Voting Phase
function VotePhase() {
  const {
    myId,
    myName,
    clues,
    players,
    playerOrder,
    selectedVote,
    setSelectedVote,
    submitVote,
    votesCount,
  } = useGame();
  const [hasVoted, setHasVoted] = useState(false);

  const handleVote = () => {
    submitVote();
    setHasVoted(true);
  };

  // Convert clues to display format
  const cluesList = playerOrder.map(playerId => {
    const player = players.find(p => p.id === playerId);
    return {
      id: playerId,
      name: player?.name || "Unknown",
      clue: clues[playerId] || "(skipped)",
    };
  });

  return (
    <div>
      <h2 className="text-xl font-semibold text-center mb-2">
        🗳️ Time to Vote!
      </h2>
      <p className="text-center text-gray-400 text-sm mb-4">
        Who is the Undercover Agent?
      </p>

      <p className="text-center text-gray-500 mb-4">
        {votesCount}/{players.length} votes cast
      </p>

      <div className="space-y-3 mb-6">
        {cluesList.map((player) => (
          <button
            key={player.id}
            onClick={() => !hasVoted && setSelectedVote(player.id)}
            disabled={hasVoted}
            className={`w-full flex items-center p-4 rounded-xl border-2 transition-all text-left ${
              selectedVote === player.id
                ? "border-green-400 bg-green-400/10"
                : "border-gray-700 bg-gray-900 hover:border-orange-400 hover:bg-orange-400/10"
            } ${hasVoted ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-emerald-300 flex items-center justify-center font-semibold text-gray-900 text-sm mr-3">
              {getInitials(player.name)}
            </div>
            <div>
              <div className="font-medium">
                {player.name}
                {player.id === myId && " (you)"}
              </div>
              <div className="text-emerald-300 text-sm">
                &quot;{player.clue}&quot;
              </div>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={handleVote}
        className="btn-primary w-full"
        disabled={!selectedVote || hasVoted}
      >
        {hasVoted ? "Vote Cast!" : "Cast Your Vote"}
      </button>
    </div>
  );
}

// Guess Phase (for caught chameleon)
function GuessPhase() {
  const { isChameleon, guessPhaseData, submitGuess } = useGame();
  const [guess, setGuess] = useState("");
  const [hasGuessed, setHasGuessed] = useState(false);

  const handleGuess = () => {
    if (guess.trim()) {
      submitGuess(guess.trim());
      setHasGuessed(true);
    }
  };

  if (!guessPhaseData) return null;

  return (
    <div className="text-center">
      <div className="text-5xl mb-4">🎯</div>
      <h2 className="text-xl font-semibold mb-2">Agent Caught!</h2>
      <p className="text-gray-400 mb-6">
        <span className="text-orange-400">{guessPhaseData.chameleonName}</span>{" "}
        was identified!
      </p>

      {isChameleon ? (
        <div className="bg-orange-400/10 border border-orange-400 rounded-xl p-5 mb-4">
          <p className="text-lg mb-3">
            🕵️ You have one chance to guess the word!
          </p>
          <p className="text-gray-400 text-sm mb-4">
            If you guess correctly, you still win!
          </p>

          <p className="text-sm text-gray-400 mb-2">
            Category:{" "}
            <strong className="text-white">{guessPhaseData.category}</strong>
          </p>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {guessPhaseData.allWords.map((word) => (
              <div
                key={word}
                className="p-2 text-center text-xs bg-gray-800 rounded-lg border border-gray-700"
              >
                {word}
              </div>
            ))}
          </div>

          <input
            type="text"
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            placeholder="Enter your guess..."
            className="input-field mb-3"
            disabled={hasGuessed}
            onKeyPress={(e) => e.key === "Enter" && handleGuess()}
          />
          <button
            onClick={handleGuess}
            className="btn-primary w-full"
            disabled={!guess.trim() || hasGuessed}
          >
            {hasGuessed ? "Submitted!" : "Submit Guess"}
          </button>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-xl p-6">
          <p className="text-gray-400">
            Waiting for{" "}
            <span className="text-orange-400">
              {guessPhaseData.chameleonName}
            </span>{" "}
            to guess the word...
          </p>
        </div>
      )}
    </div>
  );
}

// Results Phase
function ResultsPhase() {
  const { isChameleon, gameResults, isHost, playAgain } = useGame();

  if (!gameResults) return null;

  const {
    caughtChameleon,
    chameleonGuessedCorrectly,
    chameleonName,
    chameleonGuess,
    secretWord,
    mostVotedName,
    votes,
  } = gameResults;

  let resultIcon: string;
  let resultTitle: string;
  let resultMessage: string;
  let isSuccess: boolean;

  if (caughtChameleon && chameleonGuessedCorrectly) {
    resultIcon = isChameleon ? "🕵️" : "😱";
    resultTitle = isChameleon ? "You Guessed It!" : "Agent Wins!";
    resultMessage = `${chameleonName} was caught but correctly guessed "${chameleonGuess}"!`;
    isSuccess = isChameleon;
  } else if (caughtChameleon) {
    resultIcon = isChameleon ? "😱" : "🎉";
    resultTitle = isChameleon ? "You Got Caught!" : "You Win!";
    resultMessage = chameleonGuess
      ? `${chameleonName} was caught and guessed "${chameleonGuess}" - wrong!`
      : `The group successfully identified ${chameleonName} as the Undercover Agent!`;
    isSuccess = !isChameleon;
  } else {
    resultIcon = isChameleon ? "🕵️" : "😅";
    resultTitle = isChameleon ? "You Escaped!" : "Agent Wins!";
    resultMessage = `The group voted for ${mostVotedName}, but they weren't the Undercover Agent!`;
    isSuccess = isChameleon;
  }

  return (
    <div className="text-center">
      <div className="text-6xl mb-4">{resultIcon}</div>
      <h2
        className={`text-2xl font-bold mb-2 ${
          isSuccess ? "text-green-400" : "text-red-400"
        }`}
      >
        {resultTitle}
      </h2>
      <p className="text-gray-400 mb-6">{resultMessage}</p>

      <div className="bg-orange-400/10 border border-orange-400 rounded-xl p-5 mb-6">
        <p className="text-sm text-gray-400">The Undercover Agent was:</p>
        <p className="text-xl font-bold text-orange-400">{chameleonName}</p>
        <p className="text-sm text-gray-400 mt-3">The secret word was:</p>
        <p className="text-lg font-bold text-emerald-300">{secretWord}</p>
      </div>

      <div className="text-left mb-6">
        <h4 className="text-gray-400 text-sm mb-3">Vote Breakdown</h4>
        <div className="space-y-2">
          {votes.map((v, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-3 bg-gray-900 rounded-lg"
            >
              <span>{v.name}</span>
              <span className="text-orange-400">voted for {v.votedFor}</span>
            </div>
          ))}
        </div>
      </div>

      {isHost ? (
        <button onClick={playAgain} className="btn-primary w-full">
          Play Again
        </button>
      ) : (
        <p className="text-gray-400">Waiting for host to start new game...</p>
      )}
    </div>
  );
}

// Main Game Screen
export default function GameScreen() {
  const { gamePhase } = useGame();
  const [showRole, setShowRole] = useState(true);

  // Reset role view when game phase changes
  useEffect(() => {
    if (gamePhase === "playing") {
      setShowRole(true);
    }
  }, [gamePhase]);

  return (
    <div className="flex flex-col items-center">
      <div className="card max-w-xl">
        {gamePhase === "playing" && showRole && (
          <RolePhase onReady={() => setShowRole(false)} />
        )}
        {gamePhase === "playing" && !showRole && <CluePhase />}
        {gamePhase === "voting" && <VotePhase />}
        {gamePhase === "chameleon-guessing" && <GuessPhase />}
        {gamePhase === "results" && <ResultsPhase />}
      </div>
    </div>
  );
}
