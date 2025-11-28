"use client";

import CoffeeSection from "@/components/CoffeeSection";
import ConnectionStatus from "@/components/ConnectionStatus";
import GameScreen from "@/components/GameScreen";
import HomeScreen from "@/components/HomeScreen";
import LobbyScreen from "@/components/LobbyScreen";
import { useGame } from "@/contexts/GameContext";

export default function Home() {
  const { lobbyCode, gamePhase } = useGame();

  const getScreen = () => {
    if (!lobbyCode) {
      return <HomeScreen />;
    }
    if (gamePhase === "waiting") {
      return <LobbyScreen />;
    }
    return <GameScreen />;
  };

  return (
    <>
      <ConnectionStatus />

      {/* Background pattern */}
      <div className="fixed inset-0 -z-10 bg-gray-950">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(57,211,83,0.1)_0%,transparent_50%),radial-gradient(circle_at_80%_20%,rgba(126,231,135,0.08)_0%,transparent_40%),radial-gradient(circle_at_50%_50%,rgba(255,166,87,0.05)_0%,transparent_60%)] animate-pulse-slow" />
      </div>

      <main className="min-h-screen flex flex-col items-center justify-center p-5 pb-28">
        {getScreen()}
      </main>

      <CoffeeSection />
    </>
  );
}
