const FLAG_URL = (code) =>
  `https://flagcdn.com/32x24/${code.toLowerCase()}.png`;

const TWITTER_PIC = (handle) => {
  if (!handle) return null;
  const username = handle.replace('@', '');
  return `https://unavatar.io/x/${username}`;
};

function formatNumber(n) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function getRankStyle(rank) {
  if (rank === 1) return 'from-yellow-500/20 to-yellow-600/5 border-yellow-500/30';
  if (rank === 2) return 'from-gray-400/15 to-gray-500/5 border-gray-400/25';
  if (rank === 3) return 'from-amber-700/15 to-amber-800/5 border-amber-700/25';
  return 'from-transparent to-transparent border-gray-800/50';
}

function getRankBadge(rank) {
  if (rank === 1) return 'bg-yellow-500 text-black';
  if (rank === 2) return 'bg-gray-400 text-black';
  if (rank === 3) return 'bg-amber-700 text-white';
  return 'bg-gray-800 text-gray-400';
}

function MentionBar({ value, max }) {
  if (!value || !max) return null;
  const pct = Math.max(1, (value / max) * 100);
  return (
    <div className="w-full bg-gray-800/50 rounded-full h-1.5 overflow-hidden">
      <div
        className="h-1.5 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function LeaderTable({ leaders, onSelect }) {
  const maxMentions = Math.max(...leaders.map(l => l.totalMentions ?? 0), 1);

  return (
    <div className="space-y-2">
      {leaders.map((leader, i) => {
        const rank = i + 1;
        const pic = TWITTER_PIC(leader.handle);

        return (
          <div
            key={leader.id}
            onClick={() => onSelect?.(leader.id)}
            className={`
              group relative flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3
              rounded-xl border cursor-pointer
              bg-gradient-to-r ${getRankStyle(rank)}
              hover:bg-gray-800/40 transition-all duration-200
            `}
          >
            {/* Rank */}
            <div className={`
              w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0
              ${getRankBadge(rank)}
            `}>
              {rank}
            </div>

            {/* Photo + Flag */}
            <div className="relative flex-shrink-0">
              {pic ? (
                <img
                  src={pic}
                  alt={leader.name}
                  className="w-10 h-10 rounded-full object-cover bg-gray-800"
                  loading="lazy"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'flex';
                  }}
                />
              ) : null}
              <div
                className={`w-10 h-10 rounded-full bg-gray-800 items-center justify-center text-sm font-bold text-gray-500 ${pic ? 'hidden' : 'flex'}`}
              >
                {leader.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
              </div>
              {leader.countryCode && (
                <img
                  src={FLAG_URL(leader.countryCode)}
                  alt={leader.country}
                  className="absolute -bottom-1 -right-1 w-5 h-4 rounded-sm border border-gray-900 object-cover"
                  loading="lazy"
                />
              )}
            </div>

            {/* Name + Country */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-white truncate">
                  {leader.name}
                </span>
                {leader.handle && (
                  <span className="text-[11px] text-gray-500 hidden sm:inline">
                    {leader.handle}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500">{leader.country}</span>
                <div className="flex-1 max-w-[120px] hidden sm:block">
                  <MentionBar value={leader.totalMentions} max={maxMentions} />
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="text-right flex-shrink-0">
              <div className="text-sm font-bold font-mono text-white">
                {formatNumber(leader.totalMentions)}
              </div>
              {leader.last7d != null && (
                <div className="text-[11px] text-gray-500 font-mono">
                  7d: {formatNumber(leader.last7d)}
                </div>
              )}
            </div>

            {/* Arrow */}
            <div className="text-gray-600 group-hover:text-gray-400 transition-colors flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
}
