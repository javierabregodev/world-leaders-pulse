import { useState } from 'react';

const FLAG_URL = (code) => `https://flagcdn.com/24x18/${code.toLowerCase()}.png`;
const TWITTER_PIC = (handle) => handle ? `https://unavatar.io/x/${handle.replace('@', '')}` : null;

function formatCompact(n) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function getRankBadge(rank) {
  if (rank === 1) return 'bg-amber-400 text-amber-900';
  if (rank === 2) return 'bg-gray-300 text-gray-700';
  if (rank === 3) return 'bg-orange-300 text-orange-800';
  return 'bg-gray-100 text-gray-500';
}

const COLUMNS = [
  { key: 'followers', label: 'Followers', icon: '👥', getValue: l => l.tracker?.followers ?? 0, engagementOnly: true },
  { key: 'mentions', label: 'Mentions', icon: '💬', getValue: l => l.mentions ?? 0 },
  { key: 'tweets', label: 'Tweets', icon: '📝', getValue: l => l.engagement?.tweetsPosted ?? 0, engagementOnly: true },
  { key: 'likes', label: 'Likes', icon: '❤️', getValue: l => l.engagement?.totalLikes ?? 0, engagementOnly: true },
  { key: 'rts', label: 'RTs', icon: '🔁', getValue: l => l.engagement?.totalRTs ?? 0, engagementOnly: true },
  { key: 'impressions', label: 'Impr.', icon: '👁', getValue: l => l.engagement?.totalImpressions ?? 0, engagementOnly: true },
  { key: 'replies', label: 'Replies', icon: '💬', getValue: l => l.engagement?.totalReplies ?? 0, engagementOnly: true },
  { key: 'engRate', label: 'Eng%', icon: '📊', getValue: l => l.engagement?.engagementRate ?? 0, format: 'percent', engagementOnly: true },
];

export default function RankingList({ leaders, onSelect }) {
  const [sortBy, setSortBy] = useState('mentions');
  const [sortDir, setSortDir] = useState('desc');

  function handleSort(key) {
    if (sortBy === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(key);
      setSortDir('desc');
    }
  }

  const col = COLUMNS.find(c => c.key === sortBy) || COLUMNS[0];
  const sorted = [...leaders].sort((a, b) => {
    const va = col.getValue(a);
    const vb = col.getValue(b);
    return sortDir === 'desc' ? vb - va : va - vb;
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="py-2.5 px-3 text-left w-10">
              <span className="text-[10px] text-gray-400 uppercase">#</span>
            </th>
            <th className="py-2.5 px-3 text-left">
              <span className="text-[10px] text-gray-400 uppercase">Leader</span>
            </th>
            {COLUMNS.map(c => (
              <th key={c.key} className="py-2.5 px-2 text-right cursor-pointer select-none group" onClick={() => handleSort(c.key)}>
                <div className="flex items-center justify-end gap-1">
                  <span className="text-[10px] uppercase text-gray-400 group-hover:text-gray-600 transition-colors">
                    {c.label}
                  </span>
                  {sortBy === c.key && (
                    <svg width="10" height="10" viewBox="0 0 10 10" className="text-indigo-500 flex-shrink-0">
                      {sortDir === 'desc'
                        ? <path d="M5 2v6M5 8L2.5 5.5M5 8L7.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                        : <path d="M5 8V2M5 2L2.5 4.5M5 2L7.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                      }
                    </svg>
                  )}
                  {sortBy !== c.key && (
                    <svg width="10" height="10" viewBox="0 0 10 10" className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <path d="M3 4l2-2 2 2M3 6l2 2 2-2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" fill="none"/>
                    </svg>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((leader, i) => {
            const rank = i + 1;
            const pic = TWITTER_PIC(leader.handle);

            return (
              <tr
                key={leader.id}
                onClick={() => onSelect(leader.id)}
                className="border-b border-gray-50 last:border-0 hover:bg-indigo-50/40 cursor-pointer transition-colors"
              >
                {/* Rank */}
                <td className="py-2.5 px-3">
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-bold ${getRankBadge(rank)}`}>
                    {rank}
                  </span>
                </td>

                {/* Leader */}
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2.5 min-w-[180px]">
                    <div className="relative flex-shrink-0">
                      {pic ? (
                        <img src={pic} alt="" className="w-8 h-8 rounded-full object-cover bg-gray-100 ring-2 ring-white" loading="lazy"
                          onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                      ) : null}
                      <div className={`w-8 h-8 rounded-full bg-gray-100 ring-2 ring-white items-center justify-center text-[11px] font-bold text-gray-400 ${pic ? 'hidden' : 'flex'}`}>
                        {leader.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                      </div>
                      {leader.countryCode && (
                        <img src={FLAG_URL(leader.countryCode)} alt="" className="absolute -bottom-0.5 -right-0.5 w-4 h-3 rounded-sm border border-white object-cover" loading="lazy" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 truncate">{leader.name}</div>
                      <div className="text-[11px] text-gray-400 truncate">{leader.country}</div>
                    </div>
                  </div>
                </td>

                {/* Metric columns */}
                {COLUMNS.map(c => {
                  const val = c.getValue(leader);
                  const isActive = sortBy === c.key;
                  // Mentions: always show number (even 0).
                  // Engagement/Tracker metrics: show 0 if leader has a Twitter handle; "—" if not.
                  const shouldShowDash = c.engagementOnly && !leader.handle;
                  let display;
                  if (shouldShowDash) {
                    display = <span className="text-gray-300">—</span>;
                  } else if (c.format === 'percent') {
                    display = (val || 0).toFixed(2) + '%';
                  } else {
                    display = formatCompact(val || 0);
                  }
                  return (
                    <td key={c.key} className={`py-2.5 px-2 text-right font-mono text-sm ${isActive ? 'font-bold text-gray-900' : 'text-gray-500'}`}>
                      {display}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
