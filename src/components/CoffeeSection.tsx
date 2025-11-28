'use client';

import { useState } from 'react';

const VenmoIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.5 2H4.5C3.12 2 2 3.12 2 4.5v15c0 1.38 1.12 2.5 2.5 2.5h15c1.38 0 2.5-1.12 2.5-2.5v-15C22 3.12 20.88 2 19.5 2zm-3.3 6.06c0 2.66-1.88 6.5-3.4 9.08H9.02L7.37 7.44l3.3-.32.9 7.16c.84-1.4 1.87-3.58 1.87-5.06 0-.76-.13-1.3-.3-1.74l2.86-.6c.27.66.4 1.38.4 2.18z"/>
  </svg>
);

export default function CoffeeSection() {
  const [isExpanded, setIsExpanded] = useState(false);

  const venmoUrl = (amount: number) =>
    `https://venmo.com/paul_gerlich?txn=pay&amount=${amount}&note=Thanks%20for%20nobadvibes.games!`;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-gray-900 via-gray-900/95 to-transparent pt-8 pb-5 px-4 text-center z-50">
      <div className="max-w-md mx-auto">
        {!isExpanded ? (
          <button
            onClick={() => setIsExpanded(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-800 border border-gray-700 rounded-full text-gray-400 text-sm hover:border-orange-400 hover:text-white transition-all hover:-translate-y-0.5"
          >
            ☕ Enjoying the game? Buy me a coffee!
          </button>
        ) : (
          <div className="animate-fadeIn">
            <p className="text-gray-400 text-sm mb-3">
              Thanks for playing! Tips help keep the server running 💚
            </p>
            
            <div className="flex gap-3 justify-center flex-wrap">
              <a
                href={venmoUrl(1)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-400 text-white rounded-full font-semibold text-sm hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-500/30 transition-all"
              >
                <VenmoIcon />
                $1
              </a>
              <a
                href={venmoUrl(5)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-green-400 to-emerald-300 text-gray-900 rounded-full font-semibold text-sm hover:-translate-y-0.5 hover:shadow-lg hover:shadow-green-400/30 transition-all"
              >
                <VenmoIcon />
                $5
              </a>
              <a
                href={venmoUrl(10)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-400 text-white rounded-full font-semibold text-sm hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-500/30 transition-all"
              >
                <VenmoIcon />
                $10
              </a>
            </div>

            <button
              onClick={() => setIsExpanded(false)}
              className="mt-3 text-gray-500 text-xs hover:text-gray-300 transition-colors"
            >
              maybe later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
