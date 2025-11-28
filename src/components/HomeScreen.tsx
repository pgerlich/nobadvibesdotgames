"use client";

import { useGame } from "@/contexts/GameContext";
import { useState } from "react";

export default function HomeScreen() {
  const { createLobby, joinLobby, error } = useGame();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const handleCreate = () => {
    if (!name.trim()) return;
    createLobby(name.trim());
  };

  const handleJoin = () => {
    if (!name.trim() || code.length !== 4) return;
    joinLobby(code.trim(), name.trim());
  };

  return (
    <div className="flex flex-col items-center">
      <h1 className="font-serif text-5xl md:text-7xl text-center mb-3 bg-gradient-to-r from-green-400 to-emerald-300 bg-clip-text text-transparent drop-shadow-[0_0_60px_rgba(57,211,83,0.3)]">
        🕵️ Undercover
      </h1>
      <p className="text-gray-400 text-lg mb-10 text-center font-light">
        One of you doesn&apos;t belong. Find them.
      </p>

      <div className="card">
        <h2 className="text-xl font-semibold text-center mb-6">
          Join the Game
        </h2>

        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-2">Your Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            maxLength={20}
            className="input-field"
            onKeyPress={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>

        <button
          onClick={handleCreate}
          className="btn-primary w-full"
          disabled={!name.trim()}
        >
          Create New Lobby
        </button>

        <div className="flex items-center my-6 text-gray-500 text-sm">
          <div className="flex-1 h-px bg-gray-700" />
          <span className="px-4">or join existing</span>
          <div className="flex-1 h-px bg-gray-700" />
        </div>

        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-2">Lobby Code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Enter 4-letter code"
            maxLength={4}
            className="input-field uppercase"
            onKeyPress={(e) => e.key === "Enter" && handleJoin()}
          />
        </div>

        <button
          onClick={handleJoin}
          className="btn-secondary w-full"
          disabled={!name.trim() || code.length !== 4}
        >
          Join Lobby
        </button>

        {error && (
          <p className="text-red-400 text-center mt-4 text-sm">{error}</p>
        )}
      </div>
    </div>
  );
}
