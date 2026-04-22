import { useState, useRef, useEffect } from 'react';
import { searchLeaders } from '../mockData';

const FLAG_URL = (code) => `https://flagcdn.com/20x15/${code.toLowerCase()}.png`;
const TWITTER_PIC = (handle) => handle ? `https://unavatar.io/x/${handle.replace('@', '')}` : null;

function formatCompact(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

export default function SearchDropdown({ onSelect }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const results = searchLeaders(query);
  const showResults = open && query.length >= 3 && results.length > 0;

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function handleKeyDown(e) {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  }

  function handleSelect(id) {
    setOpen(false);
    setQuery('');
    onSelect(id);
  }

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search a world leader..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all placeholder:text-gray-400"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10.5 3.5l-7 7M3.5 3.5l7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        )}
      </div>

      {showResults && (
        <div className="absolute top-full mt-1.5 left-0 right-0 bg-white rounded-xl border border-gray-200 shadow-xl z-30 overflow-hidden">
          {results.map((leader) => {
            const pic = TWITTER_PIC(leader.handle);
            const isUp = leader.change >= 0;
            return (
              <div
                key={leader.id}
                onClick={() => handleSelect(leader.id)}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-indigo-50/50 cursor-pointer transition-colors border-b border-gray-50 last:border-0"
              >
                {/* Photo */}
                <div className="relative flex-shrink-0">
                  {pic ? (
                    <img src={pic} alt="" className="w-8 h-8 rounded-full object-cover bg-gray-100" loading="lazy"
                      onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                  ) : null}
                  <div className={`w-8 h-8 rounded-full bg-gray-100 items-center justify-center text-xs font-bold text-gray-400 ${pic ? 'hidden' : 'flex'}`}>
                    {leader.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                  </div>
                </div>

                {/* Name + handle */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{leader.name}</div>
                  <div className="text-[11px] text-gray-400 truncate">
                    {leader.handle && <span>{leader.handle} · </span>}
                    {leader.country}
                  </div>
                </div>

                {/* Flag */}
                {leader.countryCode && (
                  <img src={FLAG_URL(leader.countryCode)} alt="" className="w-5 h-4 rounded-sm object-cover flex-shrink-0" />
                )}

                {/* Trend */}
                <span className={`text-xs font-semibold flex-shrink-0 ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
                  {isUp ? '↑' : '↓'}{Math.abs(leader.change).toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      )}

      {open && query.length >= 3 && results.length === 0 && (
        <div className="absolute top-full mt-1.5 left-0 right-0 bg-white rounded-xl border border-gray-200 shadow-xl z-30 p-4 text-center text-sm text-gray-400">
          No leaders found for "{query}"
        </div>
      )}
    </div>
  );
}
