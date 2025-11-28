"use client";

import { useGame } from "@/contexts/GameContext";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function LobbyScreen() {
  const { lobbyCode, players, isHost, myId, startGame, leaveLobby } = useGame();
  const canStart = players.length >= 3;

  return (
    <div className="flex flex-col items-center">
      <h1 className="font-serif text-3xl text-center mb-3 bg-gradient-to-r from-green-400 to-emerald-300 bg-clip-text text-transparent">
        🕵️ Undercover
      </h1>

      <div className="card max-w-lg">
        <h2 className="text-xl font-semibold text-center mb-6">Lobby</h2>

        <div className="bg-green-400/10 rounded-xl p-5 mb-6 text-center">
          <span className="font-mono text-4xl font-bold tracking-[8px] text-emerald-300">
            {lobbyCode}
          </span>
        </div>

        <p className="text-center text-gray-400 text-sm mb-6">
          Share this code with your friends!
        </p>

        <h3 className="text-gray-400 text-sm mb-3">
          Players ({players.length}/10)
        </h3>

        <ul className="space-y-2 mb-6">
          {players.map((player) => (
            <li
              key={player.id}
              className="flex items-center p-3 bg-gray-900 rounded-lg border border-gray-700"
            >
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-green-400 to-emerald-300 flex items-center justify-center font-semibold text-gray-900 text-sm mr-3">
                {getInitials(player.name)}
              </div>
              <span className="flex-1 font-medium">{player.name}</span>
              {player.isHost && (
                <span className="text-xs px-2 py-1 rounded-full bg-orange-400 text-gray-900 font-semibold">
                  HOST
                </span>
              )}
              {player.id === myId && (
                <span className="text-xs px-2 py-1 rounded-full bg-green-400 text-gray-900 font-semibold ml-2">
                  YOU
                </span>
              )}
            </li>
          ))}
        </ul>

        {isHost ? (
          <button
            onClick={startGame}
            className="btn-primary w-full"
            disabled={!canStart}
          >
            {canStart ? "Start Game" : "Start Game (3+ players needed)"}
          </button>
        ) : (
          <p className="text-center text-gray-400">
            Waiting for host to start...
          </p>
        )}

        <button onClick={leaveLobby} className="btn-secondary w-full mt-4">
          Leave Game
        </button>
      </div>
    </div>
  );
}
