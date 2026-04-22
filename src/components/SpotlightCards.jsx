const TWITTER_PIC = (handle) => handle ? `https://unavatar.io/x/${handle.replace('@', '')}` : null;
const FLAG_URL = (code) => `https://flagcdn.com/20x15/${code.toLowerCase()}.png`;

function formatCompact(n) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function SpotCard({ label, icon, leader, value, changeValue, accentClass, onSelect }) {
  if (!leader) return null;
  const pic = TWITTER_PIC(leader.handle);
  const change = changeValue ?? leader.change;
  const isUp = change != null && change >= 0;

  return (
    <div
      onClick={() => onSelect(leader.id)}
      className={`rounded-2xl p-3.5 border shadow-sm cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 ${accentClass}`}
    >
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">{label}</span>
        <span className="text-sm">{icon}</span>
      </div>

      <div className="flex items-center gap-2.5">
        <div className="relative flex-shrink-0">
          {pic ? (
            <img src={pic} alt="" className="w-9 h-9 rounded-full object-cover bg-gray-100 ring-2 ring-white" loading="lazy"
              onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
          ) : null}
          <div className={`w-9 h-9 rounded-full bg-gray-100 ring-2 ring-white items-center justify-center text-xs font-bold text-gray-400 ${pic ? 'hidden' : 'flex'}`}>
            {leader.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
          </div>
          {leader.countryCode && (
            <img src={FLAG_URL(leader.countryCode)} alt="" className="absolute -bottom-0.5 -right-0.5 w-4 h-3 rounded-sm border border-white object-cover" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">{leader.name}</div>
          <div className="text-[11px] text-gray-400 truncate">{leader.country}</div>
        </div>
      </div>

      <div className="mt-2.5 flex items-end justify-between">
        <div className="text-lg font-bold text-gray-900">
          {value ?? formatCompact(leader.mentions)}
        </div>
        {change != null && (
          <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${
            isUp ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
          }`}>
            {isUp ? '↑' : '↓'} {Math.abs(change).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

export default function SpotlightCards({ spotlights, onSelect }) {
  const { mostMentioned, mostLiked, mostRetweeted, highestEngRate, mostActive, mostReplies, mostImpressions, mostProductive } = spotlights;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <SpotCard
        label="Most Mentioned"
        icon="🏆"
        leader={mostMentioned}
        accentClass="bg-gradient-to-br from-amber-50 to-orange-50/50 border-amber-200/50"
        onSelect={onSelect}
      />
      <SpotCard
        label="Most Active"
        icon="⚡"
        leader={mostActive}
        value={mostActive?.engagement ? mostActive.engagement.tweetsPosted + ' tweets' : '—'}
        accentClass="bg-gradient-to-br from-yellow-50 to-amber-50/50 border-yellow-200/50"
        onSelect={onSelect}
      />
      <SpotCard
        label="Most Liked"
        icon="❤️"
        leader={mostLiked}
        value={mostLiked?.engagement ? formatCompact(mostLiked.engagement.totalLikes) : '—'}
        accentClass="bg-gradient-to-br from-pink-50 to-rose-50/50 border-pink-200/50"
        onSelect={onSelect}
      />
      <SpotCard
        label="Most Retweeted"
        icon="🔁"
        leader={mostRetweeted}
        value={mostRetweeted?.engagement ? formatCompact(mostRetweeted.engagement.totalRTs) : '—'}
        accentClass="bg-gradient-to-br from-blue-50 to-indigo-50/50 border-blue-200/50"
        onSelect={onSelect}
      />
      <SpotCard
        label="Most Replies"
        icon="💬"
        leader={mostReplies}
        value={mostReplies?.engagement ? formatCompact(mostReplies.engagement.totalReplies) : '—'}
        accentClass="bg-gradient-to-br from-teal-50 to-cyan-50/50 border-teal-200/50"
        onSelect={onSelect}
      />
      <SpotCard
        label="Most Impressions"
        icon="👁"
        leader={mostImpressions}
        value={mostImpressions?.engagement ? formatCompact(mostImpressions.engagement.totalImpressions) : '—'}
        accentClass="bg-gradient-to-br from-sky-50 to-blue-50/50 border-sky-200/50"
        onSelect={onSelect}
      />
      <SpotCard
        label="Highest Eng. Rate"
        icon="📊"
        leader={highestEngRate}
        value={highestEngRate?.engagement ? highestEngRate.engagement.engagementRate + '%' : '—'}
        accentClass="bg-gradient-to-br from-violet-50 to-purple-50/50 border-violet-200/50"
        onSelect={onSelect}
      />
      <SpotCard
        label="Top Performer"
        icon="⭐"
        leader={mostProductive}
        value={mostProductive?.engagement ? formatCompact(mostProductive.engagement.avgLikesPerTweet) + ' /tweet' : '—'}
        accentClass="bg-gradient-to-br from-fuchsia-50 to-pink-50/50 border-fuchsia-200/50"
        onSelect={onSelect}
      />
    </div>
  );
}
