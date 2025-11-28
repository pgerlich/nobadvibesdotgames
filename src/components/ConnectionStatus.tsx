'use client';

import { useGame } from '@/contexts/GameContext';

export default function ConnectionStatus() {
  const { connectionStatus, error } = useGame();

  if (!connectionStatus && !error) return null;

  return (
    <>
      {connectionStatus && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-orange-500 text-white px-6 py-3 rounded-xl font-medium z-50 shadow-lg animate-fadeIn">
          {connectionStatus}
        </div>
      )}
      {error && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-xl font-medium z-50 shadow-lg animate-slideUp">
          {error}
        </div>
      )}
    </>
  );
}
