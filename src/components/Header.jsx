import { useState, useEffect } from 'react';

export default function Header() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  return (
    <header className="border-b border-gray-800/50 bg-gray-950/90 backdrop-blur-md sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-lg font-bold">
              WL
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-tight">
                World Leaders Pulse
              </h1>
              <p className="text-xs text-gray-500 leading-tight">
                Twitter/X mentions since 2020
              </p>
            </div>
          </div>
          {status && (
            <div className="text-right text-[11px] text-gray-500 leading-tight">
              <div className="flex items-center gap-1.5 justify-end">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Live — updates hourly
              </div>
              {status.lastGlobalUpdate && (
                <div className="mt-0.5">
                  {new Date(status.lastGlobalUpdate).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
