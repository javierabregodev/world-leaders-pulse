const TWITTER_PIC = (handle) => {
  if (!handle) return null;
  return `https://unavatar.io/x/${handle.replace('@', '')}`;
};

function formatCompact(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

export default function MoversCard({ title, subtitle, leaders, type, onSelect }) {
  const isUp = type === 'up';

  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm ${
          isUp ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
        }`}>
          {isUp ? '↑' : '↓'}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="text-[11px] text-gray-400">{subtitle}</p>
        </div>
      </div>

      <div className="space-y-2">
        {leaders.map((leader, i) => {
          const pic = TWITTER_PIC(leader.handle);
          const pct = Math.abs(leader.change7d).toFixed(1);

          return (
            <div
              key={leader.id}
              onClick={() => onSelect(leader.id)}
              className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <div className="relative flex-shrink-0">
                {pic ? (
                  <img src={pic} alt="" className="w-8 h-8 rounded-full object-cover bg-gray-100" loading="lazy"
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                  />
                ) : null}
                <div className={`w-8 h-8 rounded-full bg-gray-100 items-center justify-center text-xs font-bold text-gray-400 ${pic ? 'hidden' : 'flex'}`}>
                  {leader.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{leader.name}</div>
                <div className="text-[11px] text-gray-400">{formatCompact(leader.last7d)} this week</div>
              </div>

              <div className={`text-sm font-semibold ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
                {isUp ? '+' : '-'}{pct}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
